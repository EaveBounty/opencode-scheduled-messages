import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { Store } from "../src/store.js";
import { OpenCodeClient } from "../src/opencode.js";
import { createApp } from "../src/http.js";
import { tokenHash } from "../src/config.js";
import { hashPassword, verifyPassword } from "../src/util.js";

const TOKEN = "test-token";

async function startUpstream() {
  const state = { prompts: [], sessions: { ses_test: { id: "ses_test", title: "Fake", agent: "build", location: { directory: "/tmp/test" } } } };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const json = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
      res.end(text);
    };
    if (url.pathname === "/api/info") return json(200, { version: "2.1.1" });
    if (url.pathname === "/api/session/active") return json(200, { data: {} });
    if (url.pathname === "/api/session" && req.method === "GET") return json(200, { data: Object.values(state.sessions), cursor: null });
    if (url.pathname === "/api/session" && req.method === "POST") {
      const body = await readBody(req);
      const id = `ses_new_${Object.keys(state.sessions).length + 1}`;
      state.sessions[id] = { id, title: body.title, location: body.location, agent: body.agent, model: body.model };
      return json(200, state.sessions[id]);
    }
    const sessionMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
      const session = state.sessions[sessionMatch[1]];
      if (!session) return json(404, { _tag: "SessionNotFoundError", message: "not found" });
      return json(200, session);
    }
    const promptMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/prompt$/);
    if (promptMatch && req.method === "POST") {
      const body = await readBody(req);
      if (!state.sessions[promptMatch[1]]) return json(404, { _tag: "SessionNotFoundError", message: "not found" });
      state.prompts.push({ sessionID: promptMatch[1], body });
      return json(200, { data: { id: body.id, sessionID: promptMatch[1], type: "user", payload: { text: body.text }, delivery: "steer" } });
    }
    const messagesMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/message$/);
    if (messagesMatch) return json(200, { data: [], cursor: null });
    if (url.pathname === "/api/project") return json(200, []);
    if (url.pathname === "/api/model") return json(200, { data: [] });
    if (url.pathname === "/api/agent") return json(200, { data: [] });
    if (url.pathname === "/api/permission/request") return json(200, { data: [] });
    return json(404, { _tag: "NotFound", message: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function setup() {
  const upstream = await startUpstream();
  const store = new Store(":memory:");
  const config = {
    bind: "127.0.0.1",
    port: 0,
    publicUrl: null,
    auth: {
      cookieName: "ocsm_session",
      sessionDays: 1,
      tokenHash: tokenHash(TOKEN),
      cookieSecret: "test-secret",
    },
    opencode: { baseUrl: upstream.url, password: null, publicUrl: null },
    defaults: {
      timezone: "Asia/Shanghai",
      busyPolicy: "wait",
      waitMinutes: 30,
      graceMinutes: 120,
      permissionPolicy: "wait",
      permissionTimeoutMinutes: 10,
    },
    ui: { showCost: true },
  };
  const client = new OpenCodeClient({ baseUrl: upstream.url });
  const scheduler = { events: new EventEmitter(), tick: async () => {}, start() {}, stop() {} };
  const eventhub = { status: () => ({ connected: true, lastEventAt: null }), subscribe: () => () => {} };
  const app = createApp({ config, paths: { configFile: "/tmp/none", databaseFile: ":memory:" }, store, client, scheduler, eventhub });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${address.port}`;
  return { upstream, store, app, base, close: async () => { await app.close(); store.close(); await upstream.close(); } };
}

const auth = { authorization: `Bearer ${TOKEN}` };

test("serves the PWA shell and blocks unauthenticated API calls", async () => {
  const ctx = await setup();
  const index = await fetch(`${ctx.base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /OpenCode Scheduled Messages/);
  const js = await fetch(`${ctx.base}/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
  const denied = await fetch(`${ctx.base}/api/sessions`);
  assert.equal(denied.status, 401);
  const traversal = await fetch(`${ctx.base}/%2e%2e%2fpackage.json`);
  assert.equal(traversal.status, 404);
  await ctx.close();
});

test("login sets a cookie that authenticates subsequent requests", async () => {
  const ctx = await setup();
  const login = await fetch(`${ctx.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /ocsm_session=/);
  assert.match(cookie, /HttpOnly/);
  const status = await fetch(`${ctx.base}/api/auth/status`, { headers: { cookie: cookie.split(";")[0] } });
  const payload = await status.json();
  assert.equal(payload.authenticated, true);
  await ctx.close();
});

test("changes a legacy token into a scrypt password", async () => {
  const ctx = await setup();
  assert.equal(verifyPassword("new-password-123", hashPassword("new-password-123")), true);
  const change = await fetch(`${ctx.base}/api/auth/password`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ currentPassword: TOKEN, newPassword: "new-password-123" }),
  });
  assert.equal(change.status, 200);
  const oldLogin = await fetch(`${ctx.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await fetch(`${ctx.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "new-password-123" }),
  });
  assert.equal(newLogin.status, 200);
  await ctx.close();
});

test("creates, lists, edits and cancels a schedule", async () => {
  const ctx = await setup();
  const create = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      text: "night idea",
      dueAt: Date.now() + 3_600_000,
      target: { kind: "session", sessionID: "ses_test" },
      timezone: "Asia/Shanghai",
    }),
  });
  assert.equal(create.status, 201);
  const created = (await create.json()).data;
  assert.equal(created.target.title, "Fake");
  assert.equal(created.state, "pending");

  const list = await fetch(`${ctx.base}/api/schedules`, { headers: auth });
  const listed = await list.json();
  assert.equal(listed.data.length, 1);

  const edit = await fetch(`${ctx.base}/api/schedules/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ text: "edited" }),
  });
  assert.equal(edit.status, 200);
  assert.equal((await edit.json()).data.text, "edited");

  const cancel = await fetch(`${ctx.base}/api/schedules/${created.id}`, { method: "DELETE", headers: auth });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).data.state, "cancelled");
  await ctx.close();
});

test("rejects invalid payloads and past dates", async () => {
  const ctx = await setup();
  const noText = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ dueAt: Date.now() + 60_000, target: { kind: "session", sessionID: "ses_test" } }),
  });
  assert.equal(noText.status, 400);
  const past = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ text: "x", dueAt: Date.now() - 3_600_000, target: { kind: "session", sessionID: "ses_test" } }),
  });
  assert.equal(past.status, 400);
  const badTarget = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ text: "x", dueAt: Date.now() + 60_000, target: { kind: "new", directory: "relative" } }),
  });
  assert.equal(badTarget.status, 400);
  await ctx.close();
});

test("cookie writes require a matching Origin", async () => {
  const ctx = await setup();
  const login = await fetch(`${ctx.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const body = JSON.stringify({
    text: "x",
    dueAt: Date.now() + 3_600_000,
    target: { kind: "session", sessionID: "ses_test" },
  });
  const missing = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body,
  });
  assert.equal(missing.status, 403);
  const good = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { cookie, origin: ctx.base, "content-type": "application/json" },
    body,
  });
  assert.equal(good.status, 201);
  await ctx.close();
});

test("direct send forwards to OpenCode with a client-generated id", async () => {
  const ctx = await setup();
  const response = await fetch(`${ctx.base}/api/sessions/ses_test/send`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ text: "hello now" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.match(payload.data.messageID, /^msg_/);
  assert.equal(ctx.upstream.state.prompts.length, 1);
  assert.equal(ctx.upstream.state.prompts[0].body.text, "hello now");
  assert.equal(ctx.upstream.state.prompts[0].body.id, payload.data.messageID);
  await ctx.close();
});

test("cookie writes accept a same-origin Sec-Fetch-Site", async () => {
  const ctx = await setup();
  const login = await fetch(`${ctx.base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({
      text: "x",
      dueAt: Date.now() + 3_600_000,
      target: { kind: "session", sessionID: "ses_test" },
    }),
  });
  assert.equal(response.status, 201);
  await ctx.close();
});

test("refuses to cancel a schedule that was already accepted", async () => {
  const ctx = await setup();
  const create = await fetch(`${ctx.base}/api/schedules`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      text: "already sent",
      dueAt: Date.now() + 3_600_000,
      target: { kind: "session", sessionID: "ses_test" },
    }),
  });
  const created = (await create.json()).data;
  ctx.store.markAccepted(created.id, { sessionID: "ses_test", messageID: "msg_x" });
  const cancel = await fetch(`${ctx.base}/api/schedules/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(cancel.status, 409);
  await ctx.close();
});

test("clamps invalid pagination instead of forwarding NaN", async () => {
  const ctx = await setup();
  const response = await fetch(`${ctx.base}/api/sessions?limit=not-a-number`, { headers: auth });
  assert.equal(response.status, 200);
  await ctx.close();
});

test("deep links use the configured public OpenCode URL", async () => {
  const ctx = await setup();
  ctx.app.info();
  const response = await fetch(`${ctx.base}/api/sessions/ses_test/deep-link`, { headers: auth });
  const payload = await response.json();
  assert.match(payload.url, /\/server\/[A-Za-z0-9_-]+\/session\/ses_test$/);
  await ctx.close();
});
