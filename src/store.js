import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { newRunID } from "./util.js";

export const STATES = Object.freeze({
  pending: "pending",
  waiting: "waiting",
  sending: "sending",
  accepted: "accepted",
  done: "done",
  failed: "failed",
  missed: "missed",
  cancelled: "cancelled",
});

export const ACTIVE_STATES = ["pending", "waiting", "sending", "accepted"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('session', 'new')),
  session_id TEXT,
  directory TEXT,
  title TEXT,
  agent TEXT,
  model_provider TEXT,
  model_id TEXT,
  model_variant TEXT,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  state TEXT NOT NULL,
  busy_policy TEXT NOT NULL DEFAULT 'wait',
  wait_minutes INTEGER NOT NULL DEFAULT 30,
  grace_minutes INTEGER NOT NULL DEFAULT 120,
  permission_policy TEXT NOT NULL DEFAULT 'wait',
  permission_timeout_minutes INTEGER NOT NULL DEFAULT 10,
  not_before INTEGER,
  wait_deadline INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  idem_msg_id TEXT NOT NULL,
  result_session_id TEXT,
  result_message_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(state, due_at);
CREATE INDEX IF NOT EXISTS idx_schedules_not_before ON schedules(state, not_before);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,
  http_status INTEGER,
  error TEXT,
  response TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_schedule ON runs(schedule_id, started_at);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The original error is more useful.
    }
    throw error;
  }
}

export class Store {
  constructor(file, { now = Date.now } = {}) {
    this.file = file;
    this.now = now;
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL");
      } catch {
        // Some filesystems do not support WAL; the default journal still works.
      }
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec("PRAGMA busy_timeout = 3000");
    }
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    if (file !== ":memory:") {
      try {
        chmodSync(file, 0o600);
      } catch {
        // Permissions are best-effort on non-POSIX filesystems.
      }
    }
  }

  close() {
    this.db.close();
  }

  /** @param {Record<string, any>} input */
  create(input) {
    const now = this.now();
    const row = {
      id: input.id,
      target_kind: input.targetKind,
      session_id: input.sessionId ?? null,
      directory: input.directory ?? null,
      title: input.title ?? null,
      agent: input.agent ?? null,
      model_provider: input.model?.providerID ?? null,
      model_id: input.model?.id ?? null,
      model_variant: input.model?.variant ?? null,
      text: input.text,
      due_at: input.dueAt,
      timezone: input.timezone,
      state: STATES.pending,
      busy_policy: input.busyPolicy ?? "wait",
      wait_minutes: input.waitMinutes ?? 30,
      grace_minutes: input.graceMinutes ?? 120,
      permission_policy: input.permissionPolicy ?? "wait",
      permission_timeout_minutes: input.permissionTimeoutMinutes ?? 10,
      not_before: null,
      wait_deadline: null,
      attempt: 0,
      idem_msg_id: input.idemMsgId,
      result_session_id: null,
      result_message_id: null,
      last_error: null,
      created_at: now,
      updated_at: now,
      sent_at: null,
      finished_at: null,
    };
    this.db
      .prepare(
        `INSERT INTO schedules (
          id, target_kind, session_id, directory, title, agent,
          model_provider, model_id, model_variant, text, due_at, timezone, state,
          busy_policy, wait_minutes, grace_minutes, permission_policy,
          permission_timeout_minutes, not_before, wait_deadline, attempt,
          idem_msg_id, result_session_id, result_message_id, last_error,
          created_at, updated_at, sent_at, finished_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?
        )`,
      )
      .run(
        row.id,
        row.target_kind,
        row.session_id,
        row.directory,
        row.title,
        row.agent,
        row.model_provider,
        row.model_id,
        row.model_variant,
        row.text,
        row.due_at,
        row.timezone,
        row.state,
        row.busy_policy,
        row.wait_minutes,
        row.grace_minutes,
        row.permission_policy,
        row.permission_timeout_minutes,
        row.not_before,
        row.wait_deadline,
        row.attempt,
        row.idem_msg_id,
        row.result_session_id,
        row.result_message_id,
        row.last_error,
        row.created_at,
        row.updated_at,
        row.sent_at,
        row.finished_at,
      );
    return this.get(row.id);
  }

  get(id) {
    return this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) ?? null;
  }

  list({ states = null, limit = 100, offset = 0 } = {}) {
    if (Array.isArray(states) && states.length > 0) {
      const placeholders = states.map(() => "?").join(", ");
      return this.db
        .prepare(
          `SELECT * FROM schedules WHERE state IN (${placeholders})
           ORDER BY due_at DESC, created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...states, limit, offset);
    }
    return this.db
      .prepare("SELECT * FROM schedules ORDER BY due_at DESC, created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset);
  }

  stats() {
    const rows = this.db.prepare("SELECT state, COUNT(*) AS n FROM schedules GROUP BY state").all();
    const out = Object.fromEntries(Object.values(STATES).map((state) => [state, 0]));
    for (const row of rows) out[row.state] = Number(row.n);
    return out;
  }

  nextDue() {
    return (
      this.db
        .prepare(
          `SELECT MIN(COALESCE(not_before, due_at)) AS next
           FROM schedules
           WHERE state IN ('pending', 'waiting')`,
        )
        .get()?.next ?? null
    );
  }

  /** Atomically claim the next due job. Returns null when nothing is due. */
  claimDue(now = this.now()) {
    return tx(this.db, () => {
      const candidate = this.db
        .prepare(
          `SELECT id, state FROM schedules
           WHERE (state = 'pending' AND due_at <= ? AND COALESCE(not_before, 0) <= ?)
              OR (state = 'waiting' AND not_before <= ?)
           ORDER BY due_at ASC, created_at ASC
           LIMIT 1`,
        )
        .get(now, now, now);
      if (!candidate) return null;
      this.db
        .prepare(
          `UPDATE schedules
           SET state = 'sending',
               attempt = CASE WHEN state = 'waiting' THEN attempt ELSE attempt + 1 END,
               updated_at = ?, last_error = NULL
           WHERE id = ?`,
        )
        .run(now, candidate.id);
      return { ...this.get(candidate.id), _wasWaiting: candidate.state === "waiting" };
    });
  }

  startRun(schedule, now = this.now()) {
    const id = newRunID();
    this.db
      .prepare(
        `INSERT INTO runs (id, schedule_id, attempt, started_at, status)
         VALUES (?, ?, ?, ?, 'running')`,
      )
      .run(id, schedule.id, schedule.attempt, now);
    return id;
  }

  endRun(runID, { status, httpStatus = null, error = null, response = null, now = this.now() } = {}) {
    this.db
      .prepare(
        `UPDATE runs SET ended_at = ?, status = ?, http_status = ?, error = ?, response = ?
         WHERE id = ?`,
      )
      .run(now, status, httpStatus, error, response ? JSON.stringify(response).slice(0, 20000) : null, runID);
  }

  releaseWaiting(id, { notBefore, waitDeadline, now = this.now() }) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'waiting', not_before = ?, wait_deadline = ?,
             attempt = MAX(attempt - 1, 0), updated_at = ?
         WHERE id = ?`,
      )
      .run(notBefore, waitDeadline, now, id);
    return this.get(id);
  }

  retryLater(id, { notBefore, error, now = this.now(), keepAttempt = false }) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'pending', not_before = ?, last_error = ?, updated_at = ?,
             attempt = ${keepAttempt ? "MAX(attempt - 1, 0)" : "attempt"}
         WHERE id = ?`,
      )
      .run(notBefore, error, now, id);
    return this.get(id);
  }

  setResultSession(id, sessionID, now = this.now()) {
    this.db
      .prepare("UPDATE schedules SET result_session_id = ?, updated_at = ? WHERE id = ?")
      .run(sessionID, now, id);
    return this.get(id);
  }

  resetForSend(id, { dueAt = this.now(), idemMsgId, now = this.now() } = {}) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'pending', due_at = ?, not_before = NULL, wait_deadline = NULL,
             attempt = 0, idem_msg_id = COALESCE(?, idem_msg_id), last_error = NULL,
             result_message_id = NULL, sent_at = NULL, finished_at = NULL, updated_at = ?
         WHERE id = ? AND state != 'sending'`,
      )
      .run(dueAt, idemMsgId ?? null, now, id);
    return this.get(id);
  }

  markAccepted(id, { sessionID, messageID, now = this.now() }) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'accepted', result_session_id = ?, result_message_id = ?,
             sent_at = ?, updated_at = ?, last_error = NULL
         WHERE id = ?`,
      )
      .run(sessionID, messageID, now, now, id);
    return this.get(id);
  }

  markDone(id, { now = this.now() } = {}) {
    this.db
      .prepare(
        `UPDATE schedules SET state = 'done', finished_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, id);
    return this.get(id);
  }

  markFailed(id, { error, now = this.now() }) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'failed', last_error = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(error, now, now, id);
    return this.get(id);
  }

  markMissed(id, { error = null, now = this.now() }) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'missed', last_error = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(error, now, now, id);
    return this.get(id);
  }

  markCancelled(id, { now = this.now() } = {}) {
    this.db
      .prepare(
        `UPDATE schedules
         SET state = 'cancelled', finished_at = ?, updated_at = ?
         WHERE id = ? AND state IN ('pending', 'waiting', 'missed', 'failed')`,
      )
      .run(now, now, id);
    return this.get(id);
  }

  /**
   * Apply user edits. Only pending/waiting/missed tasks can be edited; the
   * caller decides which fields are allowed.
   */
  update(id, patch, now = this.now()) {
    const allowed = [
      ["text", "text"],
      ["dueAt", "due_at"],
      ["timezone", "timezone"],
      ["busyPolicy", "busy_policy"],
      ["waitMinutes", "wait_minutes"],
      ["graceMinutes", "grace_minutes"],
      ["permissionPolicy", "permission_policy"],
      ["permissionTimeoutMinutes", "permission_timeout_minutes"],
      ["title", "title"],
      ["agent", "agent"],
      ["directory", "directory"],
    ];
    const sets = [];
    const values = [];
    for (const [key, column] of allowed) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[key]);
      }
    }
    if (patch.model !== undefined) {
      sets.push("model_provider = ?", "model_id = ?", "model_variant = ?");
      values.push(patch.model?.providerID ?? null, patch.model?.id ?? null, patch.model?.variant ?? null);
    }
    if (sets.length === 0) return this.get(id);
    sets.push("updated_at = ?", "state = 'pending'", "not_before = NULL", "wait_deadline = NULL");
    values.push(now);
    values.push(id);
    this.db
      .prepare(
        `UPDATE schedules SET ${sets.join(", ")}
         WHERE id = ? AND state IN ('pending', 'waiting', 'missed', 'failed')`,
      )
      .run(...values);
    return this.get(id);
  }

  /**
   * Recover jobs that were mid-flight when the process died. A send is safe to
   * retry because the message id is stable and the upstream is idempotent.
   */
  recover(now = this.now(), { staleAfterMs = 120_000, maxAttempts = 3 } = {}) {
    const recovered = [];
    const sending = this.db
      .prepare("SELECT * FROM schedules WHERE state = 'sending' AND updated_at < ?")
      .all(now - staleAfterMs);
    for (const row of sending) {
      if (row.attempt >= maxAttempts) {
        this.markFailed(row.id, { error: "Interrupted during send; retry limit reached", now });
        recovered.push({ id: row.id, action: "failed" });
      } else {
        this.retryLater(row.id, { notBefore: now, error: "Interrupted during send; retrying", now });
        recovered.push({ id: row.id, action: "retry" });
      }
    }
    const waiting = this.db
      .prepare("SELECT * FROM schedules WHERE state = 'waiting' AND wait_deadline < ?")
      .all(now);
    for (const row of waiting) {
      this.markMissed(row.id, { error: "Session stayed busy past the wait deadline", now });
      recovered.push({ id: row.id, action: "missed" });
    }
    return recovered;
  }

  setKV(key, value) {
    this.db
      .prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, typeof value === "string" ? value : JSON.stringify(value));
    return value;
  }

  getKV(key, fallback = null) {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  runsFor(scheduleID, limit = 20) {
    return this.db
      .prepare("SELECT * FROM runs WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(scheduleID, limit);
  }
}
