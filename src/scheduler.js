import { EventEmitter } from "node:events";
import { formatInZone, log, newMessageID } from "./util.js";
import { isRetryable, OpenCodeError } from "./opencode.js";
import { scheduleView } from "./serialize.js";
import { STATES } from "./store.js";

const RETRY_DELAYS = [30_000, 120_000, 600_000];
const READONLY_ACTIONS = new Set(["read", "glob", "grep", "list", "skill", "lsp"]);

function unwrap(value) {
  if (value && typeof value === "object" && "data" in value) return value.data;
  return value;
}

export class Scheduler {
  constructor({
    store,
    client,
    config,
    now = Date.now,
    events = new EventEmitter(),
    tickMs = 10_000,    maxAttempts = 3,
    logger = log,
  }) {
    this.store = store;
    this.client = client;
    this.config = config;
    this.now = now;
    this.events = events;
    this.tickMs = tickMs;
    this.maxAttempts = maxAttempts;
    this.logger = logger;
    this.timer = null;
    this.busy = false;
    this.watchers = new Map();
  }

  start() {
    const recovered = this.store.recover(this.now());
    if (recovered.length) this.logger("info", "Recovered interrupted schedules", { recovered });
    this.timer = setInterval(() => {
      this.tick().catch((error) => this.logger("error", "Scheduler tick failed", { error: error.message }));
    }, this.tickMs);
    this.timer.unref?.();
    this.tick().catch((error) => this.logger("error", "Initial scheduler tick failed", { error: error.message }));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const watcher of this.watchers.values()) clearInterval(watcher.timer);
    this.watchers.clear();
  }

  /** Process every currently due job; safe to call from tests. */
  async drain() {
    if (this.busy) return 0;
    this.busy = true;
    let processed = 0;
    try {
      while (processed < 25) {
        const job = this.store.claimDue(this.now());
        if (!job) break;
        await this.process(job);
        processed += 1;
      }
      return processed;
    } finally {
      this.busy = false;
    }
  }

  async tick() {
    return this.drain();
  }

  async process(job) {
    const now = this.now();
    const runID = this.store.startRun(job, now);
    let sessionID = job.result_session_id || job.session_id;
    let directory = job.directory || null;

    try {
      if (job._wasWaiting && job.wait_deadline && now >= job.wait_deadline) {
        this.finish(runID, job, "missed", "Session stayed busy past the wait deadline");
        return this.store.markMissed(job.id, {
          error: "Session stayed busy past the wait deadline",
          now,
        });
      }

      // First pickup after downtime: do not resurrect stale ideas hours later.
      if (!job._wasWaiting && job.attempt <= 1) {
        const lateBy = now - job.due_at;
        if (lateBy > job.grace_minutes * 60_000) {
          this.finish(runID, job, "missed", `Missed the ${job.grace_minutes} minute grace window`);
          return this.store.markMissed(job.id, {
            error: `Missed the ${job.grace_minutes} minute grace window`,
            now,
          });
        }
      }

      const health = await this.client.health();
      if (!health.ok) throw new OpenCodeError(health.error || "OpenCode is offline", { status: 0 });

      if (!sessionID) {
        const created = unwrap(
          await this.client.createSession({
            title:
              job.title ||
              `Scheduled · ${formatInZone(job.due_at, job.timezone)}`,
            directory: job.directory,
            agent: job.agent || undefined,
            model: job.model_id
              ? {
                  providerID: job.model_provider,
                  id: job.model_id,
                  variant: job.model_variant || undefined,
                }
              : undefined,
            metadata: { ocsched: { scheduleID: job.id } },
          }),
        );
        sessionID = created?.id;
        directory = created?.location?.directory || job.directory || null;
        if (!sessionID) throw new OpenCodeError("OpenCode did not return a session id", { status: 0 });
        this.store.setResultSession(job.id, sessionID, now);
      }

      let session = null;
      try {
        session = unwrap(await this.client.getSession(sessionID));
      } catch (error) {
        if (error instanceof OpenCodeError && error.status === 404) {
          throw new OpenCodeError(`Target session no longer exists: ${sessionID}`, {
            status: 404,
            tag: "SessionNotFoundError",
          });
        }
        throw error;
      }
      if (!directory) directory = session?.location?.directory || null;

      const active = unwrap(await this.client.activeSessions()) || {};
      const isRunning = Boolean(active[sessionID]);
      let delivery;

      if (isRunning) {
        if (job.busy_policy === "skip") {
          this.finish(runID, job, "missed", "Session was busy");
          return this.store.markMissed(job.id, { error: "Session was busy", now });
        }
        if (job.busy_policy === "steer") {
          delivery = "steer";
        } else {
          const deadline = job.wait_deadline || now + job.wait_minutes * 60_000;
          if (now >= deadline) {
            this.finish(runID, job, "missed", "Session stayed busy past the wait deadline");
            return this.store.markMissed(job.id, {
              error: "Session stayed busy past the wait deadline",
              now,
            });
          }
          const notBefore = now + Math.min(30_000, Math.max(1_000, deadline - now));
          this.store.endRun(runID, { status: "waiting", now });
          return this.store.releaseWaiting(job.id, { notBefore, waitDeadline: deadline, now });
        }
      }

      const result = unwrap(
        await this.client.promptSession(sessionID, {
          id: job.idem_msg_id,
          text: job.text,
          ...(delivery ? { delivery } : {}),
          metadata: {
            ocsched: {
              scheduleID: job.id,
              dueAt: job.due_at,
              attempt: job.attempt,
            },
          },
        }),
      );

      if (!result?.id) {
        throw new OpenCodeError("OpenCode accepted the request but returned no message id", { status: 0 });
      }
      if (result.id !== job.idem_msg_id) {
        throw new OpenCodeError(
          `Idempotency mismatch: expected ${job.idem_msg_id}, got ${result.id}`,
          { status: 0 },
        );
      }
      const echoed = result.payload?.text ?? result.text;
      if (echoed !== undefined && echoed !== job.text) {
        throw new OpenCodeError("Idempotency mismatch: upstream echoed different text", { status: 0 });
      }

      this.store.endRun(runID, { status: "accepted", httpStatus: 200, response: result, now: this.now() });
      const updated = this.store.markAccepted(job.id, {
        sessionID,
        messageID: result.id,
        now: this.now(),
      });
      this.emit("schedule.accepted", updated, { sessionID });
      if (job.permission_policy !== "wait") {
        this.watchPermissions(job, sessionID, directory);
      }
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = isRetryable(error);
      const offline = error instanceof OpenCodeError && error.status === 0;
      const attempt = job.attempt;
      const now = this.now();
      const pastGrace = now - job.due_at > job.grace_minutes * 60_000;

      // OpenCode being offline is not a failed send. Keep the idea alive until
      // the grace window closes, then mark it missed instead of spamming.
      if (offline && !pastGrace) {
        this.store.endRun(runID, { status: "retry", error: message, now });
        const updated = this.store.retryLater(job.id, {
          notBefore: now + 60_000,
          error: message,
          now,
          keepAttempt: true,
        });
        this.emit("schedule.retry", updated);
        return updated;
      }
      if (offline && pastGrace) {
        this.finish(runID, job, "missed", `OpenCode was offline past the grace window: ${message}`);
        const updated = this.store.markMissed(job.id, {
          error: `OpenCode was offline past the grace window: ${message}`,
          now,
        });
        this.emit("schedule.missed", updated);
        return updated;
      }

      this.store.endRun(runID, {
        status: retryable ? "retry" : "failed",
        httpStatus: error?.status ?? null,
        error: message,
        now,
      });
      if (retryable && attempt < this.maxAttempts) {
        const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
        this.logger("warn", "Schedule send failed; retrying", {
          id: job.id,
          attempt,
          delay,
          error: message,
        });
        const updated = this.store.retryLater(job.id, {
          notBefore: now + delay,
          error: message,
          now,
        });
        this.emit("schedule.retry", updated);
        return updated;
      }
      this.logger("error", "Schedule send failed permanently", { id: job.id, error: message });
      const updated = this.store.markFailed(job.id, { error: message, now });
      this.emit("schedule.failed", updated);
      return updated;
    }
  }

  finish(runID, job, status, error) {
    this.store.endRun(runID, { status, error, now: this.now() });
    this.logger("info", "Schedule finished without sending", { id: job.id, status, error });
  }

  emit(type, row, extra = {}) {
    this.events.emit("event", {
      type,
      schedule: scheduleView(row),
      at: Date.now(),
      ...extra,
    });
  }

  /**
   * Bounded permission watchdog. It never approves shell/edit unless the user
   * explicitly chose allow-all for this specific schedule.
   */
  watchPermissions(job, sessionID, directory) {
    if (this.watchers.has(job.id)) return;
    const timeoutMs = job.permission_timeout_minutes * 60_000;
    const started = this.now();
    const firstSeen = new Map();
    const watcher = { timer: null, started };
    const tick = async () => {
      if (this.now() - started > timeoutMs) {
        clearInterval(watcher.timer);
        this.watchers.delete(job.id);
        return;
      }
      try {
        const payload = unwrap(await this.client.listPermissions(directory)) || {};
        const requests = Array.isArray(payload.data) ? payload.data : [];
        for (const request of requests) {
          if (request.sessionID !== sessionID) continue;
          if (!firstSeen.has(request.id)) firstSeen.set(request.id, this.now());
          const seenFor = this.now() - firstSeen.get(request.id);
          if (job.permission_policy === "allow-all") {
            await this.client.replyPermission(sessionID, request.id, "once");
            this.emit("permission.approved", job, { request: request.id, action: request.action });
            firstSeen.delete(request.id);
          } else if (
            job.permission_policy === "allow-readonly" &&
            READONLY_ACTIONS.has(request.action)
          ) {
            await this.client.replyPermission(sessionID, request.id, "once");
            this.emit("permission.approved", job, { request: request.id, action: request.action });
            firstSeen.delete(request.id);
          } else if (job.permission_policy === "reject" && seenFor >= timeoutMs) {
            await this.client.replyPermission(
              sessionID,
              request.id,
              "reject",
              "Scheduled message: permission was not pre-approved.",
            );
            this.emit("permission.rejected", job, { request: request.id, action: request.action });
            firstSeen.delete(request.id);
          }
        }
      } catch (error) {
        this.logger("warn", "Permission watchdog failed", { id: job.id, error: error.message });
      }
    };
    watcher.timer = setInterval(() => {
      tick().catch(() => {});
    }, 5_000);
    watcher.timer.unref?.();
    this.watchers.set(job.id, watcher);
    tick().catch(() => {});
  }
}

export { STATES, newMessageID };
