import { base64url, log } from "./util.js";

export class OpenCodeError extends Error {
  constructor(message, { status = 0, tag = null, body = null, path = null } = {}) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status;
    this.tag = tag;
    this.body = body;
    this.path = path;
  }
}

export function isRetryable(error) {
  if (!(error instanceof OpenCodeError)) return true; // network, DNS, abort
  if (error.status === 0) return true;
  if (error.status === 408 || error.status === 425 || error.status === 429) return true;
  if (error.status === 409) return true;
  return error.status >= 500;
}

export class OpenCodeClient {
  constructor({ baseUrl, password = null, timeoutMs = 15_000, publicUrl = null } = {}) {
    if (!baseUrl) throw new Error("OpenCode base URL is required");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.publicUrlOverride = publicUrl ? publicUrl.replace(/\/+$/, "") : null;
    this.auth = password ? `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` : null;
  }

  headers(extra = {}) {
    return {
      accept: "application/json",
      ...(this.auth ? { authorization: this.auth } : {}),
      ...extra,
    };
  }

  url(path, query) {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  async request(method, path, { body, query, timeoutMs = this.timeoutMs, signal, headers } = {}) {
    const url = this.url(path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const response = await fetch(url, {
        method,
        headers: this.headers({
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
      });
      const text = response.status === 204 ? "" : await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!response.ok) {
        const message =
          (data && typeof data === "object" && (data.message || data._tag)) ||
          `${response.status} ${response.statusText}`;
        throw new OpenCodeError(String(message), {
          status: response.status,
          tag: data && typeof data === "object" ? data._tag : null,
          body: data,
          path,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof OpenCodeError) throw error;
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        throw new OpenCodeError(`Request timed out: ${method} ${path}`, { status: 0, path });
      }
      throw new OpenCodeError(`Cannot reach OpenCode at ${this.baseUrl}: ${error.message}`, {
        status: 0,
        path,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async info() {
    return this.request("GET", "/api/info", { timeoutMs: 5_000 });
  }

  async health() {
    try {
      const info = await this.info();
      return { ok: true, info };
    } catch (error) {
      return { ok: false, error: error.message, status: error.status ?? 0 };
    }
  }

  async listSessions({ limit = 50, order = "desc", search, parentID, archived } = {}) {
    return this.request("GET", "/api/session", {
      query: { limit, order, search, parentID, archived },
    });
  }

  async getSession(sessionID) {
    return this.request("GET", `/api/session/${encodeURIComponent(sessionID)}`);
  }

  async createSession({ title, agent, model, directory, permissions, metadata } = {}) {
    return this.request("POST", "/api/session", {
      body: {
        ...(title ? { title } : {}),
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
        ...(directory ? { location: { directory } } : {}),
        ...(permissions ? { permissions } : {}),
        ...(metadata ? { metadata } : {}),
      },
    });
  }

  async promptSession(sessionID, { id, text, delivery, metadata, resume, files, agents, skills } = {}) {
    return this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      body: {
        ...(id ? { id } : {}),
        text,
        ...(delivery ? { delivery } : {}),
        ...(metadata ? { metadata } : {}),
        ...(resume !== undefined ? { resume } : {}),
        ...(files ? { files } : {}),
        ...(agents ? { agents } : {}),
        ...(skills ? { skills } : {}),
      },
    });
  }

  async listMessages(sessionID, { limit = 30, order = "desc", cursor, type } = {}) {
    return this.request("GET", `/api/session/${encodeURIComponent(sessionID)}/message`, {
      query: { limit, order, cursor, type },
    });
  }

  async listProjects() {
    return this.request("GET", "/api/project");
  }

  async listModels() {
    return this.request("GET", "/api/model");
  }

  async listAgents() {
    return this.request("GET", "/api/agent");
  }

  async activeSessions() {
    return this.request("GET", "/api/session/active");
  }

  async switchModel(sessionID, model) {
    return this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/model`, {
      body: { model },
    });
  }

  async interrupt(sessionID) {
    return this.request("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`, { body: {} });
  }

  async listPermissions(directory) {
    return this.request("GET", "/api/permission/request", {
      query: directory ? { "location[directory]": directory } : undefined,
    });
  }

  async replyPermission(sessionID, requestID, decision, message) {
    return this.request(
      "POST",
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
      {
        body: { decision, ...(message ? { message } : {}) },
      },
    );
  }

  /**
   * Consume the OpenCode event stream. The caller owns reconnection policy.
   * Yields parsed JSON events (the `type` field is inside the payload).
   */
  async *eventStream({ signal } = {}) {
    const url = this.url("/api/event");
    const response = await fetch(url, {
      headers: this.headers({ accept: "text/event-stream" }),
      signal,
    });
    if (!response.ok) {
      throw new OpenCodeError(`Event stream failed: ${response.status}`, {
        status: response.status,
        path: "/api/event",
      });
    }
    if (!response.body) throw new OpenCodeError("Event stream has no body", { status: 0 });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = parseEventBlock(block);
          if (event !== null) yield event;
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    } finally {
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
    }
  }

  /**
   * Public URL used to build native UI deep links. For Tailscale/Cloudflare,
   * set `opencode.publicUrl` explicitly (for example https://host.ts.net:8443).
   * Otherwise derive the same host with the upstream port, which is what LAN
   * users need.
   */
  publicUrl(requestOrigin) {
    if (this.publicUrlOverride) return this.publicUrlOverride.replace(/\/+$/, "");
    if (requestOrigin) {
      try {
        const origin = new URL(requestOrigin);
        const upstream = new URL(this.baseUrl);
        const port = upstream.port ? `:${upstream.port}` : "";
        return `${origin.protocol}//${origin.hostname}${port}`;
      } catch {
        // fall through
      }
    }
    return this.baseUrl;
  }

  deepLink(sessionID, origin) {
    const base = this.publicUrl(origin);
    const key = base64url(base);
    return `${base}/server/${key}/session/${encodeURIComponent(sessionID)}`;
  }
}

function parseEventBlock(block) {
  const lines = block.split(/\r?\n/);
  const data = [];
  for (const line of lines) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  const payload = data.join("\n");
  try {
    return JSON.parse(payload);
  } catch {
    log("debug", "Ignoring non-JSON SSE event", { payload: payload.slice(0, 200) });
    return null;
  }
}
