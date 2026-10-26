import { OpenCodeError } from "../src/opencode.js";

export class FakeClient {
  constructor(options = {}) {
    this.healthOk = options.healthOk ?? true;
    this.active = options.active ?? {};
    this.sessions = options.sessions ?? {};
    this.promptError = options.promptError ?? null;
    this.createError = options.createError ?? null;
    this.permissions = options.permissions ?? [];
    this.inbox = options.inbox ?? [];
    this.prompts = [];
    this.created = [];
    this.permissionReplies = [];
    this.calls = [];
  }

  async health() {
    this.calls.push(["health"]);
    return this.healthOk
      ? { ok: true, info: { version: "2.1.1" } }
      : { ok: false, error: "offline", status: 0 };
  }

  async info() {
    return { version: "2.1.1" };
  }

  async getSession(id) {
    this.calls.push(["getSession", id]);
    if (this.sessions[id] === null) {
      throw new OpenCodeError(`Session not found: ${id}`, {
        status: 404,
        tag: "SessionNotFoundError",
      });
    }
    return (
      this.sessions[id] ?? {
        id,
        title: "Test session",
        agent: "build",
        location: { directory: "/tmp/test-project" },
      }
    );
  }

  async activeSessions() {
    this.calls.push(["activeSessions"]);
    return { data: this.active };
  }

  async createSession(input) {
    this.calls.push(["createSession", input]);
    if (this.createError) throw this.createError;
    this.created.push(input);
    return {
      id: `ses_new_${this.created.length}`,
      title: input.title,
      location: { directory: input.location?.directory || "/tmp/test-project" },
    };
  }

  async promptSession(sessionID, input) {
    this.calls.push(["promptSession", sessionID, input]);
    if (this.promptError) throw this.promptError;
    this.prompts.push({ sessionID, input });
    return {
      id: input.id,
      sessionID,
      type: "user",
      payload: { text: input.text },
      delivery: input.delivery || "steer",
    };
  }

  async listPermissions() {
    this.calls.push(["listPermissions"]);
    return { data: this.permissions };
  }

  async listInbox() {
    this.calls.push(["listInbox"]);
    return { data: this.inbox };
  }

  async getMessage(sessionID, messageID) {
    this.calls.push(["getMessage", sessionID, messageID]);
    const item = this.inbox.find((entry) => entry.id === messageID);
    if (!item) throw new OpenCodeError("not found", { status: 404 });
    return item;
  }

  async replyPermission(sessionID, requestID, decision, message) {
    this.calls.push(["replyPermission", sessionID, requestID, decision, message]);
    this.permissionReplies.push({ sessionID, requestID, decision, message });
  }

  async listSessions() {
    return { data: [] };
  }

  async listProjects() {
    return [];
  }

  async listModels() {
    return { data: [] };
  }

  async listAgents() {
    return { data: [] };
  }
}
