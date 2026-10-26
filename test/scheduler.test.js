import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Store } from "../src/store.js";
import { Scheduler } from "../src/scheduler.js";
import { FakeClient } from "./fake-client.js";
import { OpenCodeError } from "../src/opencode.js";
import { sleep } from "../src/util.js";

const T0 = 1_800_000_000_000;

function setup({ client = new FakeClient(), now = T0 } = {}) {
  const clock = { value: now };
  const store = new Store(":memory:", { now: () => clock.value });
  const scheduler = new Scheduler({
    store,
    client,
    config: { defaults: {} },
    now: () => clock.value,
    events: new EventEmitter(),
    logger: () => {},
  });
  const create = (overrides = {}) =>
    store.create({
      id: overrides.id || "sch_test",
      targetKind: overrides.targetKind || "session",
      sessionId: overrides.sessionId === undefined ? "ses_1" : overrides.sessionId,
      directory: overrides.directory || "/tmp/test-project",
      title: overrides.title || "Test",
      agent: overrides.agent || "build",
      model: overrides.model || null,
      text: overrides.text || "hello",
      dueAt: overrides.dueAt ?? clock.value,
      timezone: "Asia/Shanghai",
      busyPolicy: overrides.busyPolicy || "wait",
      waitMinutes: overrides.waitMinutes ?? 30,
      graceMinutes: overrides.graceMinutes ?? 120,
      permissionPolicy: overrides.permissionPolicy || "wait",
      permissionTimeoutMinutes: overrides.permissionTimeoutMinutes ?? 10,
      idemMsgId: overrides.idemMsgId || "msg_test",
    });
  return { clock, store, scheduler, client, create };
}

test("sends immediately to an idle existing session", async () => {
  const { store, scheduler, client, create } = setup();
  const row = create();
  await scheduler.drain();
  const updated = store.get(row.id);
  assert.equal(updated.state, "accepted");
  assert.equal(updated.attempt, 1);
  assert.equal(updated.result_session_id, "ses_1");
  assert.equal(client.prompts.length, 1);
  assert.equal(client.prompts[0].input.id, "msg_test");
  assert.equal(client.prompts[0].input.text, "hello");
  assert.equal(client.prompts[0].input.delivery, undefined);
});

test("keeps waiting while the target session is busy, then sends", async () => {
  const client = new FakeClient({ active: { ses_1: { type: "running" } } });
  const { clock, store, scheduler, create } = setup({ client });
  const row = create();
  await scheduler.drain();
  let updated = store.get(row.id);
  assert.equal(updated.state, "waiting");
  assert.equal(updated.attempt, 0);
  assert.ok(updated.wait_deadline > clock.value);
  assert.equal(client.prompts.length, 0);

  clock.value += 31_000;
  client.active = {};
  await scheduler.drain();
  updated = store.get(row.id);
  assert.equal(updated.state, "accepted");
  assert.equal(client.prompts.length, 1);
});

test("marks missed when the busy wait deadline passes", async () => {
  const client = new FakeClient({ active: { ses_1: { type: "running" } } });
  const { store, scheduler, create } = setup({ client });
  const row = create({ waitMinutes: 0 });
  await scheduler.drain();
  assert.equal(store.get(row.id).state, "missed");
  assert.equal(client.prompts.length, 0);
});

test("respects the grace window when OpenCode was offline", async () => {
  const client = new FakeClient({ healthOk: false });
  const { clock, store, scheduler, create } = setup({ client });
  const row = create({ dueAt: clock.value - 30 * 60_000, graceMinutes: 120 });
  await scheduler.drain();
  let updated = store.get(row.id);
  assert.equal(updated.state, "pending");
  assert.equal(updated.attempt, 0);
  assert.ok(updated.not_before >= clock.value + 60_000);

  // Still offline after the grace window: mark missed, do not send.
  clock.value += 121 * 60_000;
  await scheduler.drain();
  updated = store.get(row.id);
  assert.equal(updated.state, "missed");
  assert.equal(client.prompts.length, 0);
});

test("does not resurrect a stale idea beyond the grace window", async () => {
  const client = new FakeClient();
  const { clock, store, scheduler, create } = setup({ client });
  const row = create({ dueAt: clock.value - 3 * 60 * 60_000, graceMinutes: 120 });
  await scheduler.drain();
  assert.equal(store.get(row.id).state, "missed");
  assert.equal(client.prompts.length, 0);
});

test("retries a transient upstream error with the same message id", async () => {
  const client = new FakeClient();
  client.promptError = new OpenCodeError("upstream exploded", { status: 500 });
  const { clock, store, scheduler, create } = setup({ client });
  const row = create();
  await scheduler.drain();
  let updated = store.get(row.id);
  assert.equal(updated.state, "pending");
  assert.equal(updated.attempt, 1);
  assert.equal(updated.idem_msg_id, "msg_test");

  client.promptError = null;
  clock.value += 31_000;
  await scheduler.drain();
  updated = store.get(row.id);
  assert.equal(updated.state, "accepted");
  assert.equal(updated.attempt, 2);
  assert.equal(client.prompts.length, 1);
  assert.equal(client.prompts[0].input.id, "msg_test");
});

test("creates a new session and then sends into it", async () => {
  const { store, scheduler, client, create } = setup();
  const row = create({
    targetKind: "new",
    sessionId: null,
    title: "Night idea",
    directory: "/tmp/test-project",
    model: { providerID: "opencode-go", id: "deepseek-v4.1-flash", variant: "high" },
  });
  await scheduler.drain();
  const updated = store.get(row.id);
  assert.equal(updated.state, "accepted");
  assert.equal(updated.result_session_id, "ses_new_1");
  assert.equal(client.created.length, 1);
  assert.equal(client.created[0].title, "Night idea");
  assert.equal(client.created[0].model.id, "deepseek-v4.1-flash");
  assert.equal(client.prompts[0].sessionID, "ses_new_1");
});

test("fails permanently when the target session no longer exists", async () => {
  const client = new FakeClient({ sessions: { ses_gone: null } });
  const { store, scheduler, create } = setup({ client });
  const row = create({ sessionId: "ses_gone" });
  await scheduler.drain();
  const updated = store.get(row.id);
  assert.equal(updated.state, "failed");
  assert.match(updated.last_error, /no longer exists/);
  assert.equal(client.prompts.length, 0);
});

test("rejects an idempotency mismatch instead of accepting the wrong text", async () => {
  const client = new FakeClient();
  client.promptSession = async (sessionID, input) => ({ id: "msg_other", payload: { text: "wrong" } });
  const { store, scheduler, create } = setup({ client });
  const row = create();
  await scheduler.drain();
  assert.notEqual(store.get(row.id).state, "accepted");
});

test("steers into a running turn when configured", async () => {
  const client = new FakeClient({ active: { ses_1: { type: "running" } } });
  const { store, scheduler, create } = setup({ client });
  const row = create({ busyPolicy: "steer" });
  await scheduler.drain();
  assert.equal(store.get(row.id).state, "accepted");
  assert.equal(client.prompts[0].input.delivery, "steer");
});

test("reconciles a 409 against the durable inbox", async () => {
  const client = new FakeClient({
    inbox: [{ id: "msg_test", payload: { text: "hello" }, sessionID: "ses_1" }],
  });
  client.promptError = new OpenCodeError("conflict", { status: 409 });
  const { store, scheduler, create } = setup({ client });
  const row = create();
  await scheduler.drain();
  const updated = store.get(row.id);
  assert.equal(updated.state, "accepted");
  assert.equal(updated.result_message_id, "msg_test");
});

test("retries a timeout instead of treating it as offline", async () => {
  const client = new FakeClient();
  client.promptError = new OpenCodeError("timeout", { status: 408 });
  const { clock, store, scheduler, create } = setup({ client });
  const row = create();
  await scheduler.drain();
  const updated = store.get(row.id);
  assert.equal(updated.state, "pending");
  assert.equal(updated.attempt, 1);
  assert.ok(updated.not_before >= clock.value + 30_000);

  client.promptError = null;
  clock.value += 31_000;
  await scheduler.drain();
  assert.equal(store.get(row.id).state, "accepted");
});

test("skips when busy and configured to skip", async () => {
  const client = new FakeClient({ active: { ses_1: { type: "running" } } });
  const { store, scheduler, create } = setup({ client });
  const row = create({ busyPolicy: "skip" });
  await scheduler.drain();
  assert.equal(store.get(row.id).state, "missed");
  assert.equal(client.prompts.length, 0);
});

test("resumes permission watchdogs after a restart", async () => {
  const client = new FakeClient({
    permissions: [{ id: "perm_1", sessionID: "ses_1", action: "shell" }],
  });
  const { store, scheduler, create } = setup({ client });
  const row = create({ permissionPolicy: "allow-all" });
  store.markAccepted(row.id, { sessionID: "ses_1", messageID: "msg_test" });
  scheduler.start();
  await sleep(50);
  scheduler.stop();
  assert.equal(client.permissionReplies.length, 1);
  assert.equal(client.permissionReplies[0].decision, "once");
});

test("read-only permission policy never approves shell", async () => {
  const client = new FakeClient({
    permissions: [{ id: "perm_1", sessionID: "ses_1", action: "shell" }],
  });
  const { store, scheduler, create } = setup({ client });
  const row = create({ permissionPolicy: "allow-readonly" });
  store.markAccepted(row.id, { sessionID: "ses_1", messageID: "msg_test" });
  scheduler.start();
  await sleep(50);
  scheduler.stop();
  assert.equal(client.permissionReplies.length, 0);
});
