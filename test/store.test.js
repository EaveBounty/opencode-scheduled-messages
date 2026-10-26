import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";

const T0 = 1_800_000_000_000;

function makeStore() {
  return new Store(":memory:", { now: () => T0 });
}

function makeRow(store, overrides = {}) {
  return store.create({
    id: overrides.id || "sch_1",
    targetKind: "session",
    sessionId: "ses_1",
    directory: "/tmp/test",
    title: "Test",
    agent: "build",
    model: null,
    text: "hello",
    dueAt: overrides.dueAt ?? T0,
    timezone: "Asia/Shanghai",
    busyPolicy: "wait",
    waitMinutes: 30,
    graceMinutes: 120,
    permissionPolicy: "wait",
    permissionTimeoutMinutes: 10,
    idemMsgId: "msg_1",
    ...overrides,
  });
}

test("claim increments attempt for new sends but not for busy waits", () => {
  const store = makeStore();
  const row = makeRow(store);
  const first = store.claimDue(T0);
  assert.equal(first.state, "sending");
  assert.equal(first.attempt, 1);
  assert.equal(first._wasWaiting, false);
  store.releaseWaiting(row.id, { notBefore: T0 + 30_000, waitDeadline: T0 + 60_000, now: T0 });
  assert.equal(store.get(row.id).attempt, 0);
  const second = store.claimDue(T0 + 31_000);
  assert.equal(second._wasWaiting, true);
  assert.equal(second.attempt, 0);
  store.close();
});

test("update moves a waiting row back to pending and clears wait fields", () => {
  const store = makeStore();
  const row = makeRow(store);
  store.claimDue(T0);
  store.releaseWaiting(row.id, { notBefore: T0 + 30_000, waitDeadline: T0 + 60_000, now: T0 });
  const updated = store.update(row.id, { text: "edited", dueAt: T0 + 3_600_000 }, T0 + 1_000);
  assert.equal(updated.state, "pending");
  assert.equal(updated.text, "edited");
  assert.equal(updated.not_before, null);
  assert.equal(updated.wait_deadline, null);
  store.close();
});

test("cancel only affects rows that have not been accepted", () => {
  const store = makeStore();
  makeRow(store, { id: "sch_1" });
  makeRow(store, { id: "sch_2" });
  store.markAccepted("sch_2", { sessionID: "ses_1", messageID: "msg_1", now: T0 });
  assert.equal(store.markCancelled("sch_1", { now: T0 }).state, "cancelled");
  assert.equal(store.markCancelled("sch_2", { now: T0 }).state, "accepted");
  store.close();
});

test("recover retries stale sends and misses expired waits", () => {
  const store = makeStore();
  const send = makeRow(store, { id: "sch_send" });
  const wait = makeRow(store, { id: "sch_wait" });
  store.claimDue(T0);
  store.releaseWaiting(wait.id, { notBefore: T0 + 30_000, waitDeadline: T0 + 60_000, now: T0 });
  store.retryLater(send.id, { notBefore: T0, error: "stale", now: T0 });
  store.claimDue(T0);
  const actions = store.recover(T0 + 200_000, { staleAfterMs: 120_000 });
  assert.deepEqual(
    actions.map((item) => item.action).sort(),
    ["missed", "retry"],
  );
  assert.equal(store.get(send.id).state, "pending");
  assert.equal(store.get(wait.id).state, "missed");
  store.close();
});

test("resetForSend can swap the idempotency key for a manual resend", () => {
  const store = makeStore();
  const row = makeRow(store);
  store.markAccepted(row.id, { sessionID: "ses_1", messageID: "msg_1", now: T0 });
  const reset = store.resetForSend(row.id, { dueAt: T0 + 5_000, idemMsgId: "msg_2", now: T0 });
  assert.equal(reset.state, "pending");
  assert.equal(reset.idem_msg_id, "msg_2");
  assert.equal(reset.result_message_id, null);
  store.close();
});

test("nextDue considers waiting not_before and pending due_at", () => {
  const store = makeStore();
  makeRow(store, { id: "sch_1", dueAt: T0 + 60_000 });
  makeRow(store, { id: "sch_2", dueAt: T0 + 120_000 });
  assert.equal(store.nextDue(), T0 + 60_000);
  store.close();
});

test("nextDue prefers an earlier waiting not_before", () => {
  const store = makeStore();
  const wait = makeRow(store, { id: "sch_wait", dueAt: T0 + 120_000 });
  makeRow(store, { id: "sch_pending", dueAt: T0 + 60_000 });
  store.claimDue(T0 + 120_000);
  store.releaseWaiting(wait.id, { notBefore: T0 + 30_000, waitDeadline: T0 + 300_000, now: T0 + 120_000 });
  assert.equal(store.nextDue(), T0 + 30_000);
  store.close();
});
