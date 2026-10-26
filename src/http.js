import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  base64url,
  clamp,
  fromIso,
  hmac,
  isValidTimezone,
  log,
  newMessageID,
  newScheduleID,
  safeEqual,
  VERSION,
} from "./util.js";
import { persistConfig, tokenHash as hashToken } from "./config.js";
import { OpenCodeError } from "./opencode.js";
import { messageView, scheduleView } from "./serialize.js";
import { STATES } from "./store.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const SCHEDULE_STATES = Object.values(STATES);
const BUSY_POLICIES = new Set(["wait", "steer", "skip"]);
const PERMISSION_POLICIES = new Set(["wait", "reject", "allow-readonly", "allow-all"]);
const DECISIONS = new Set(["once", "always", "reject"]);

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const bad = (message, details) => {
  throw new HttpError(400, "bad_request", message, details);
};

function unwrap(value) {
  return value && typeof value === "object" && "data" in value ? value.data : value;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function isSecure(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return proto === "https" || Boolean(req.socket.encrypted);
}

function requestOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

function cookieValue(secret, days) {
  const expires = Date.now() + days * 86_400_000;
  return `${expires}.${hmac(secret, expires)}`;
}

function verifyCookie(secret, value) {
  const [expiresRaw, signature] = String(value || "").split(".");
  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  return safeEqual(signature, hmac(secret, expires));
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, code, message, details) {
  sendJson(res, status, { error: { code, message, ...(details ? { details } : {}) } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "payload_too_large", "Request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  return data;
}

function compileRoute(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      keys.push(part.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { regex: new RegExp(`^${source}/?$`), keys };
}

function numberField(value, name, { min, max, fallback } = {}) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    bad(`${name} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) bad(`${name} must be a number`);
  if (min !== undefined && number < min) bad(`${name} must be >= ${min}`);
  if (max !== undefined && number > max) bad(`${name} must be <= ${max}`);
  return Math.round(number);
}

function enumField(value, name, allowed, fallback) {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    bad(`${name} is required`);
  }
  if (!allowed.has(value)) bad(`${name} must be one of: ${[...allowed].join(", ")}`);
  return value;
}

function dueAtField(value, name = "dueAt") {
  const ms = typeof value === "number" ? value : fromIso(value);
  if (!Number.isFinite(ms)) bad(`${name} must be an ISO date or epoch milliseconds`);
  return ms;
}

function safeOrigin(value, name) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("bad protocol");
    return url.origin;
  } catch {
    bad(`${name} must be an http(s) URL`);
  }
}

export function createApp({ config, paths, store, client, scheduler, eventhub, version = VERSION, startedAt = Date.now() }) {
  const routes = [];
  const loginAttempts = new Map();

  function route(method, pattern, handler, { auth = true, csrf = true } = {}) {
    const compiled = compileRoute(pattern);
    routes.push({ method, handler, auth, csrf, ...compiled });
  }

  function authenticate(req) {
    const header = String(req.headers.authorization || "");
    if (header.startsWith("Bearer ")) {
      const token = header.slice(7).trim();
      if (safeEqual(hashToken(token), config.auth.tokenHash)) return { ok: true, via: "bearer" };
    }
    const cookies = parseCookies(req.headers.cookie);
    const value = cookies[config.auth.cookieName];
    if (value && verifyCookie(config.auth.cookieSecret, value)) return { ok: true, via: "cookie" };
    return { ok: false, via: null };
  }

  function originAllowed(req, auth) {
    if (auth.via === "bearer") return true;
    const origin = String(req.headers.origin || "");
    if (!origin) return false;
    try {
      const allowed = new Set([
        String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim(),
      ]);
      if (config.publicUrl) allowed.add(new URL(config.publicUrl).host);
      return allowed.has(new URL(origin).host);
    } catch {
      return false;
    }
  }

  function loginAllowed(ip) {
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record || now > record.reset) {
      loginAttempts.set(ip, { count: 1, reset: now + 15 * 60_000 });
      return true;
    }
    if (record.count >= 10) return false;
    record.count += 1;
    return true;
  }

  function setSessionCookie(req, res) {
    const value = cookieValue(config.auth.cookieSecret, config.auth.sessionDays);
    const parts = [
      `${config.auth.cookieName}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Max-Age=${config.auth.sessionDays * 86_400}`,
    ];
    if (isSecure(req)) parts.push("Secure");
    res.setHeader("set-cookie", parts.join("; "));
  }

  function clearSessionCookie(res) {
    res.setHeader(
      "set-cookie",
      `${config.auth.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    );
  }

  // ---- public / auth -------------------------------------------------------

  route("GET", "/api/health", async ({ res }) => {
    sendJson(res, 200, {
      ok: true,
      version,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      upstream: eventhub.status(),
      scheduler: { nextDue: store.nextDue(), stats: store.stats() },
    });
  }, { auth: false });

  route("GET", "/api/auth/status", async ({ req, res }) => {
    const auth = authenticate(req);
    sendJson(res, 200, { authenticated: auth.ok, via: auth.via });
  }, { auth: false });

  route("POST", "/api/auth/login", async ({ req, res }) => {
    const ip = req.socket.remoteAddress || "unknown";
    if (!loginAllowed(ip)) throw new HttpError(429, "rate_limited", "Too many login attempts");
    const body = await readJson(req);
    const token = String(body.token || "");
    if (!token || !safeEqual(hashToken(token), config.auth.tokenHash)) {
      throw new HttpError(401, "invalid_token", "Invalid access token");
    }
    setSessionCookie(req, res);
    sendJson(res, 200, { ok: true });
  }, { auth: false, csrf: false });

  route("POST", "/api/auth/logout", async ({ res }) => {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });

  // ---- state / settings ----------------------------------------------------

  route("GET", "/api/state", async ({ req, res }) => {
    const origin = requestOrigin(req);
    const health = await client.health();
    sendJson(res, 200, {
      version,
      server: {
        origin,
        publicUrl: config.publicUrl || origin,
        opencodeBaseUrl: config.opencode.baseUrl,
        opencodePublicUrl: client.publicUrl(origin),
        nativeDeepLinkBase: client.publicUrl(origin),
        connected: health.ok,
        upstreamVersion: health.ok ? health.info?.version ?? null : null,
      },
      defaults: config.defaults,
      ui: config.ui,
      stats: store.stats(),
      nextDue: store.nextDue(),
      eventStream: eventhub.status(),
      platform: process.platform,
    });
  });

  route("GET", "/api/settings", async ({ res }) => {
    sendJson(res, 200, {
      defaults: config.defaults,
      ui: config.ui,
      publicUrl: config.publicUrl,
      opencodePublicUrl: config.opencode.publicUrl,
      opencodeBaseUrl: config.opencode.baseUrl,
      bind: config.bind,
      port: config.port,
      configFile: paths.configFile,
      databaseFile: paths.databaseFile,
    });
  });

  route("PATCH", "/api/settings", async ({ req, res }) => {
    const body = await readJson(req);
    if (body.defaults !== undefined) {
      const next = { ...config.defaults, ...body.defaults };
      if (!isValidTimezone(next.timezone)) bad("defaults.timezone is not a valid IANA timezone");
      next.busyPolicy = enumField(next.busyPolicy, "defaults.busyPolicy", BUSY_POLICIES);
      next.permissionPolicy = enumField(
        next.permissionPolicy,
        "defaults.permissionPolicy",
        PERMISSION_POLICIES,
      );
      next.waitMinutes = numberField(next.waitMinutes, "defaults.waitMinutes", { min: 0, max: 1440 });
      next.graceMinutes = numberField(next.graceMinutes, "defaults.graceMinutes", { min: 0, max: 10_080 });
      next.permissionTimeoutMinutes = numberField(
        next.permissionTimeoutMinutes,
        "defaults.permissionTimeoutMinutes",
        { min: 1, max: 1440 },
      );
      config.defaults = next;
    }
    if (body.publicUrl !== undefined) {
      config.publicUrl = body.publicUrl ? safeOrigin(body.publicUrl, "publicUrl") : null;
    }
    if (body.opencodePublicUrl !== undefined) {
      const value = body.opencodePublicUrl ? safeOrigin(body.opencodePublicUrl, "opencodePublicUrl") : null;
      config.opencode.publicUrl = value;
      client.publicUrlOverride = value;
    }
    if (body.ui !== undefined) config.ui = { ...config.ui, ...body.ui };
    await persistConfig(paths, config);
    sendJson(res, 200, { ok: true, settings: { defaults: config.defaults, publicUrl: config.publicUrl, opencodePublicUrl: config.opencode.publicUrl } });
  });

  // ---- OpenCode read-through ----------------------------------------------

  route("GET", "/api/sessions", async ({ req, res, url }) => {
    const limit = clamp(Number(url.searchParams.get("limit") || 50), 1, 100);
    const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
    const includeChildren = url.searchParams.get("includeChildren") === "1";
    const data = await client.listSessions({
      limit,
      order,
      search: url.searchParams.get("search") || undefined,
      parentID: includeChildren ? undefined : "null",
      archived: url.searchParams.get("archived") || undefined,
    });
    sendJson(res, 200, data);
  });

  route("GET", "/api/sessions/:id", async ({ res, params }) => {
    sendJson(res, 200, await client.getSession(params.id));
  });

  route("GET", "/api/sessions/:id/messages", async ({ res, params, url }) => {
    const limit = clamp(Number(url.searchParams.get("limit") || 30), 1, 100);
    const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
    const data = await client.listMessages(params.id, {
      limit,
      order,
      cursor: url.searchParams.get("cursor") || undefined,
      type: url.searchParams.get("type") || undefined,
    });
    sendJson(res, 200, {
      data: (data?.data ?? []).map(messageView),
      cursor: data?.cursor ?? null,
    });
  });

  route("GET", "/api/sessions/:id/deep-link", async ({ req, res, params }) => {
    sendJson(res, 200, { url: client.deepLink(params.id, requestOrigin(req)) });
  });

  route("POST", "/api/sessions/:id/send", async ({ req, res, params }) => {
    const body = await readJson(req);
    const text = String(body.text || "").trim();
    if (!text) bad("text is required");
    if (text.length > 20_000) bad("text must be <= 20000 characters");
    const id = newMessageID();
    const result = unwrap(
      await client.promptSession(params.id, {
        id,
        text,
        ...(body.delivery === "steer" ? { delivery: "steer" } : {}),
        metadata: { ocsched: { manual: true } },
      }),
    );
    sendJson(res, 200, { data: { messageID: result?.id || id } });
  });

  route("GET", "/api/projects", async ({ res }) => {
    sendJson(res, 200, await client.listProjects());
  });

  route("GET", "/api/models", async ({ res }) => {
    sendJson(res, 200, await client.listModels());
  });

  route("GET", "/api/agents", async ({ res }) => {
    sendJson(res, 200, await client.listAgents());
  });

  route("GET", "/api/active", async ({ res }) => {
    sendJson(res, 200, await client.activeSessions());
  });

  route("GET", "/api/permissions", async ({ res, url }) => {
    sendJson(res, 200, await client.listPermissions(url.searchParams.get("directory") || undefined));
  });

  route("POST", "/api/permissions/:sessionID/:requestID/reply", async ({ req, res, params }) => {
    const body = await readJson(req);
    const decision = enumField(body.decision, "decision", DECISIONS);
    await client.replyPermission(params.sessionID, params.requestID, decision, body.message);
    sendJson(res, 200, { ok: true });
  });

  // ---- schedules -----------------------------------------------------------

  route("GET", "/api/schedules", async ({ res, url }) => {
    const stateParam = url.searchParams.get("state");
    let states = null;
    if (stateParam) {
      states = stateParam.split(",").map((value) => value.trim()).filter(Boolean);
      for (const state of states) {
        if (!SCHEDULE_STATES.includes(state)) bad(`Unknown state: ${state}`);
      }
    }
    const limit = clamp(Number(url.searchParams.get("limit") || 100), 1, 200);
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    sendJson(res, 200, {
      data: store.list({ states, limit, offset }).map(scheduleView),
      stats: store.stats(),
      nextDue: store.nextDue(),
    });
  });

  route("GET", "/api/schedules/:id", async ({ res, params }) => {
    const row = store.get(params.id);
    if (!row) throw new HttpError(404, "not_found", "Schedule not found");
    sendJson(res, 200, { data: scheduleView(row), runs: store.runsFor(params.id) });
  });

  route("POST", "/api/schedules", async ({ req, res }) => {
    const body = await readJson(req);
    const now = Date.now();
    const text = String(body.text || "").trim();
    if (!text) bad("text is required");
    if (text.length > 20_000) bad("text must be <= 20000 characters");

    const target = body.target && typeof body.target === "object" ? body.target : {};
    const kind = target.kind === "session" ? "session" : target.kind === "new" ? "new" : null;
    if (!kind) bad("target.kind must be 'session' or 'new'");

    const timezone = body.timezone || config.defaults.timezone;
    if (!isValidTimezone(timezone)) bad("timezone must be a valid IANA timezone");

    const graceMinutes = numberField(body.graceMinutes, "graceMinutes", {
      min: 0,
      max: 10_080,
      fallback: config.defaults.graceMinutes,
    });
    const dueAt = dueAtField(body.dueAt);
    if (dueAt < now - 60_000) {
      bad("dueAt is in the past; use /send-now for an immediate send");
    }

    const busyPolicy = enumField(body.busyPolicy, "busyPolicy", BUSY_POLICIES, config.defaults.busyPolicy);
    const waitMinutes = numberField(body.waitMinutes, "waitMinutes", {
      min: 0,
      max: 1440,
      fallback: config.defaults.waitMinutes,
    });
    const permissionPolicy = enumField(
      body.permissionPolicy,
      "permissionPolicy",
      PERMISSION_POLICIES,
      config.defaults.permissionPolicy,
    );
    const permissionTimeoutMinutes = numberField(
      body.permissionTimeoutMinutes,
      "permissionTimeoutMinutes",
      { min: 1, max: 1440, fallback: config.defaults.permissionTimeoutMinutes },
    );

    let sessionID = null;
    let directory = null;
    let title = body.title ? String(body.title).slice(0, 200) : null;
    let agent = body.agent ? String(body.agent).slice(0, 100) : null;
    let model = null;

    if (body.model?.id && body.model?.providerID) {
      model = {
        providerID: String(body.model.providerID),
        id: String(body.model.id),
        ...(body.model.variant ? { variant: String(body.model.variant) } : {}),
      };
    }

    if (kind === "session") {
      sessionID = String(target.sessionID || "");
      if (!/^ses/.test(sessionID)) bad("target.sessionID must start with 'ses'");
      const session = unwrap(await client.getSession(sessionID));
      if (!session?.id) throw new HttpError(404, "session_not_found", "Target session not found");
      title = title || session.title || null;
      directory = session.location?.directory || null;
      model = null; // never silently switch an existing session's model
      agent = session.agent || null;
    } else {
      directory = String(target.directory || "").trim();
      if (!directory.startsWith("/")) bad("target.directory must be an absolute path");
      if (!title) title = null;
    }

    const row = store.create({
      id: newScheduleID(),
      targetKind: kind,
      sessionId: sessionID,
      directory,
      title,
      agent,
      model,
      text,
      dueAt,
      timezone,
      busyPolicy,
      waitMinutes,
      graceMinutes,
      permissionPolicy,
      permissionTimeoutMinutes,
      idemMsgId: newMessageID(),
    });
    scheduler.tick().catch((error) => log("error", "Scheduler tick after create failed", { error: error.message }));
    sendJson(res, 201, { data: scheduleView(row) });
  });

  route("PATCH", "/api/schedules/:id", async ({ req, res, params }) => {
    const existing = store.get(params.id);
    if (!existing) throw new HttpError(404, "not_found", "Schedule not found");
    if (!["pending", "waiting"].includes(existing.state)) {
      throw new HttpError(409, "not_editable", "Only pending or waiting schedules can be edited");
    }
    const body = await readJson(req);
    const patch = {};
    if (body.text !== undefined) {
      const text = String(body.text).trim();
      if (!text) bad("text cannot be empty");
      if (text.length > 20_000) bad("text must be <= 20000 characters");
      patch.text = text;
    }
    if (body.dueAt !== undefined) {
      const dueAt = dueAtField(body.dueAt);
      if (dueAt < Date.now() - 60_000) bad("dueAt is in the past");
      patch.dueAt = dueAt;
    }
    if (body.timezone !== undefined) {
      if (!isValidTimezone(body.timezone)) bad("timezone must be a valid IANA timezone");
      patch.timezone = body.timezone;
    }
    if (body.busyPolicy !== undefined) patch.busyPolicy = enumField(body.busyPolicy, "busyPolicy", BUSY_POLICIES);
    if (body.waitMinutes !== undefined) patch.waitMinutes = numberField(body.waitMinutes, "waitMinutes", { min: 0, max: 1440 });
    if (body.graceMinutes !== undefined) patch.graceMinutes = numberField(body.graceMinutes, "graceMinutes", { min: 0, max: 10_080 });
    if (body.permissionPolicy !== undefined) patch.permissionPolicy = enumField(body.permissionPolicy, "permissionPolicy", PERMISSION_POLICIES);
    if (body.permissionTimeoutMinutes !== undefined) patch.permissionTimeoutMinutes = numberField(body.permissionTimeoutMinutes, "permissionTimeoutMinutes", { min: 1, max: 1440 });
    if (body.title !== undefined) patch.title = body.title ? String(body.title).slice(0, 200) : null;
    if (body.agent !== undefined) patch.agent = body.agent ? String(body.agent).slice(0, 100) : null;
    if (body.directory !== undefined && existing.target_kind === "new") {
      if (!String(body.directory).startsWith("/")) bad("directory must be an absolute path");
      patch.directory = String(body.directory);
    }
    const updated = store.update(params.id, patch);
    scheduler.tick().catch((error) => log("error", "Scheduler tick after update failed", { error: error.message }));
    sendJson(res, 200, { data: scheduleView(updated) });
  });

  route("DELETE", "/api/schedules/:id", async ({ res, params }) => {
    const existing = store.get(params.id);
    if (!existing) throw new HttpError(404, "not_found", "Schedule not found");
    const updated = store.markCancelled(params.id);
    sendJson(res, 200, { data: scheduleView(updated) });
  });

  route("POST", "/api/schedules/:id/send-now", async ({ res, params }) => {
    const existing = store.get(params.id);
    if (!existing) throw new HttpError(404, "not_found", "Schedule not found");
    if (existing.state === "sending") throw new HttpError(409, "in_flight", "This schedule is already being sent");
    const keepId = ["pending", "waiting"].includes(existing.state);
    const updated = store.resetForSend(params.id, {
      dueAt: Date.now(),
      idemMsgId: keepId ? existing.idem_msg_id : newMessageID(),
    });
    scheduler.tick().catch((error) => log("error", "Scheduler tick after send-now failed", { error: error.message }));
    sendJson(res, 200, { data: scheduleView(updated) });
  });

  route("POST", "/api/schedules/:id/retry", async ({ res, params }) => {
    const existing = store.get(params.id);
    if (!existing) throw new HttpError(404, "not_found", "Schedule not found");
    if (!["failed", "missed"].includes(existing.state)) {
      throw new HttpError(409, "not_retryable", "Only failed or missed schedules can be retried");
    }
    const updated = store.resetForSend(params.id, {
      dueAt: Date.now(),
      idemMsgId: newMessageID(),
    });
    scheduler.tick().catch((error) => log("error", "Scheduler tick after retry failed", { error: error.message }));
    sendJson(res, 200, { data: scheduleView(updated) });
  });

  route("GET", "/api/schedules/:id/runs", async ({ res, params }) => {
    sendJson(res, 200, { data: store.runsFor(params.id) });
  });

  // ---- live events ---------------------------------------------------------

  route("GET", "/api/events", async ({ req, res, url }) => {
    const sessionFilter = url.searchParams.get("session") || null;
    const includeDeltas = url.searchParams.get("deltas") === "1";
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();
    req.socket.setTimeout(0);
    res.write("retry: 3000\n\n");

    const write = (event) => {
      if (res.writableEnded) return;
      if (!includeDeltas && typeof event.type === "string" && /(\.delta$|\.streamed$)/.test(event.type)) {
        return;
      }
      if (sessionFilter && event.sessionID && event.sessionID !== sessionFilter) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    write({
      type: "hello",
      at: Date.now(),
      upstream: eventhub.status(),
      stats: store.stats(),
      nextDue: store.nextDue(),
    });

    const unsubscribeHub = eventhub.subscribe(write);
    const schedulerListener = (event) => write(event);
    scheduler.events.on("event", schedulerListener);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, 25_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribeHub();
      scheduler.events.off("event", schedulerListener);
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  // ---- static PWA ----------------------------------------------------------

  async function serveStatic(req, res, pathname) {
    let relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    try {
      relative = decodeURIComponent(relative);
    } catch {
      throw new HttpError(400, "bad_path", "Invalid path encoding");
    }
    if (relative.includes("\0") || relative.includes("..")) {
      throw new HttpError(404, "not_found", "Not found");
    }
    let file = path.resolve(PUBLIC_DIR, relative);
    if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(404, "not_found", "Not found");
    let info = null;
    try {
      info = await stat(file);
      if (info.isDirectory()) {
        file = path.join(file, "index.html");
        info = await stat(file);
      }
    } catch {
      if (!path.extname(relative)) {
        file = path.join(PUBLIC_DIR, "index.html");
        info = await stat(file);
      } else {
        throw new HttpError(404, "not_found", "Not found");
      }
    }
    const etag = `W/"${info.size}-${Math.round(info.mtimeMs)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag, "cache-control": "no-cache" });
      res.end();
      return;
    }
    const body = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const noCache = [".html", ".webmanifest"].includes(ext) || file.endsWith("sw.js");
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": body.length,
      etag,
      "cache-control": noCache ? "no-cache" : "public, max-age=86400",
      ...(file.endsWith("sw.js") ? { "service-worker-allowed": "/" } : {}),
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  }

  // ---- dispatcher ----------------------------------------------------------

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.on("finish", () => {
      if (req.url?.startsWith("/api/")) {
        log("debug", `${req.method} ${req.url} -> ${res.statusCode}`, { ms: Date.now() - started });
      }
    });

    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method || "GET")) {
          throw new HttpError(405, "method_not_allowed", "Method not allowed");
        }
        await serveStatic(req, res, url.pathname);
        return;
      }

      let matched = null;
      for (const candidate of routes) {
        if (candidate.method !== req.method) continue;
        const match = candidate.regex.exec(url.pathname);
        if (!match) continue;
        matched = {
          handler: candidate.handler,
          auth: candidate.auth,
          csrf: candidate.csrf,
          params: Object.fromEntries(candidate.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])),
        };
        break;
      }
      if (!matched) throw new HttpError(404, "not_found", "API route not found");

      let auth = { ok: false, via: null };
      if (matched.auth) {
        auth = authenticate(req);
        if (!auth.ok) throw new HttpError(401, "unauthorized", "Authentication required");
      }
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method || "") && matched.csrf && !originAllowed(req, auth)) {
        throw new HttpError(403, "bad_origin", "Cross-origin write rejected");
      }

      await matched.handler({ req, res, url, params: matched.params });
    } catch (error) {
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          // stream already gone
        }
        return;
      }
      let status = 500;
      let code = "internal_error";
      let message = "Internal server error";
      let details;
      if (error instanceof HttpError) {
        status = error.status;
        code = error.code;
        message = error.message;
        details = error.details;
      } else if (error instanceof OpenCodeError) {
        status = error.status === 404 ? 404 : 502;
        code = error.tag === "UnauthorizedError" ? "opencode_auth" : "opencode_error";
        message =
          error.tag === "UnauthorizedError"
            ? "OpenCode rejected the gateway credentials"
            : error.message;
        details = { upstreamStatus: error.status, upstreamTag: error.tag };
      } else {
        log("error", "Unhandled request error", { error: error?.stack || String(error) });
      }
      sendError(res, status, code, message, details);
    }
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return {
    server,
    routes,
    authenticate,
    listen({ host = config.bind, port = config.port } = {}) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      });
    },
    info() {
      return {
        version,
        bind: config.bind,
        port: config.port,
        publicUrl: config.publicUrl,
        base64Origin: base64url(config.publicUrl || ""),
      };
    },
  };
}
