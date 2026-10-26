# Architecture

## 1. Constraints

- OpenCode V2.1's HTTP API is the only integration surface. The OpenCode process, its web UI and its ~900 MB database are untouched.
- The scheduler must survive browser sleep, gateway restarts and OpenCode restarts.
- The mobile UI must be usable over a phone browser without shipping a React/Vite build.
- One user, one OpenCode instance, one gateway. No multi-tenant auth.

## 2. Components

```
public/                 vanilla PWA (no build step)
  index.html             shell, CSP-safe, no inline script
  app.js                 hash router, API client, SSE, rendering
  app.css                design tokens + components
  sw.js                  shell cache, network-first navigation
  manifest.webmanifest    PWA metadata
src/
  main.js                CLI, config bootstrap, HTTP listen, shutdown
  config.js              paths, token hash, cookie secret, service.json discovery
  store.js               SQLite schema + atomic state transitions
  scheduler.js           10 s tick, claim/process/retry, permission watchdog
  opencode.js            typed-ish API client, Basic auth, SSE parser
  eventhub.js            one upstream SSE connection, fan-out + reconnect
  http.js                router, auth, CSRF, static, gateway routes, SSE endpoint
  serialize.js           DB row -> public camelCase, message compaction
  util.js                ids, time, redaction, logging
```

There are **no runtime dependencies**. `node:sqlite` is the only experimental API; Node ≥22.6 is required.

## 3. Request flow

### 3.1 Browser → gateway

1. `GET /` serves `public/index.html` with a strict CSP (`script-src 'self'`).
2. Login posts the one-time token to `/api/auth/login`. The gateway compares `sha256("ocsm:" + token)` in constant time and sets `ocsm_session=<exp>.<hmac>` (`HttpOnly; SameSite=Strict; Secure` when HTTPS).
3. Every other `/api/*` route requires the cookie or `Authorization: Bearer <token>`.
4. Cookie-authenticated writes also require `Origin` to match `Host` / `X-Forwarded-Host` / configured public URL. This is the CSRF boundary; no separate CSRF token is needed with `SameSite=Strict`.
5. The browser never sees the OpenCode password. The gateway injects `Basic base64("opencode:" + password)` on the server side.

### 3.2 Gateway → OpenCode

- Base URL: `OPENCODE_BASE_URL` → config → `~/.config/opencode/service.json` (`hostname`/`port`; `0.0.0.0` rewritten to `127.0.0.1`).
- Password: `OPENCODE_PASSWORD` → config → `service.json`. Never persisted by the gateway.
- Errors are normalized to `{status, tag, message}`. `401` is surfaced as `opencode_auth`; `404` as a missing session; `5xx`/`429`/`409` are retryable.

## 4. Data model (SQLite)

```sql
schedules(
  id TEXT PRIMARY KEY,              -- sch_...
  target_kind TEXT,                 -- session | new
  session_id TEXT,                  -- existing target
  directory TEXT, title TEXT, agent TEXT,
  model_provider TEXT, model_id TEXT, model_variant TEXT,
  text TEXT,
  due_at INTEGER,                   -- epoch ms UTC
  timezone TEXT,                    -- IANA, for display
  state TEXT,                       -- see below
  busy_policy TEXT, wait_minutes INTEGER,
  grace_minutes INTEGER,
  permission_policy TEXT, permission_timeout_minutes INTEGER,
  not_before INTEGER, wait_deadline INTEGER,
  attempt INTEGER,                  -- actual send attempts only
  idem_msg_id TEXT,                 -- stable msg_ id
  result_session_id TEXT, result_message_id TEXT,
  last_error TEXT,
  created_at INTEGER, updated_at INTEGER,
  sent_at INTEGER, finished_at INTEGER
)
runs(id, schedule_id, attempt, started_at, ended_at, status, http_status, error, response)
kv(key, value)
```

WAL, `synchronous=NORMAL`, `busy_timeout=3000`, DB file mode `0600`, process `umask 077`. The gateway is the only writer.

Indexes: `(state, due_at)`, `(state, not_before)`.

## 5. State machine

```
                 claim (attempt+1)
pending ─────────────────────────────► sending
  ▲                                        │
  │ retryLater (same idem id)              ├── prompt 200 + id match ──► accepted ──► done
  └────────────────────────────────────────┤
                                           ├── 4xx permanent ──────────► failed
                                           ├── grace expired ──────────► missed
                                           └── session busy ──► waiting ──► sending
                                                                  │
                                                                  └── deadline ──► missed
pending / waiting / missed / failed ── cancel ──► cancelled
```

Key rules:

- **Attempts count sends, not waits.** `claimDue` increments `attempt` only when the previous state was `pending`. `releaseWaiting` decrements the claim's increment, so a busy loop does not exhaust retries.
- **One claim at a time.** `BEGIN IMMEDIATE` + a single `SELECT ... LIMIT 1` + `UPDATE` guarantees no double processing, even if the HTTP handler and the interval fire together. `Scheduler.drain()` also has an in-process `busy` guard.
- **Client-side idempotency.** The `msg_` id is generated once at schedule creation, stored, and reused on every retry. OpenCode returns the original inbox item for the same id. The code verifies both `data.id` and the echoed text; a mismatch fails loudly instead of accepting the wrong content.
- **Grace before health.** A first pickup later than `due_at + grace_minutes` becomes `missed` without contacting OpenCode. This prevents a stale idea from firing after a long outage.
- **Offline is not failure.** `status === 0` (network/timeout) keeps the row `pending` with a 60 s recheck and **does not consume an attempt**; after the grace window it becomes `missed`.
- **Transient upstream errors** (`5xx`, `429`, `408`, `409`) retry at 30 s / 2 min / 10 min, then `failed`.
- **Permanent errors** (400/401/403/404) go straight to `failed`.
- **Manual resend** generates a fresh `msg_` id, because the old id may already have been accepted. The UI labels this as “重发”.

## 6. Scheduling loop

- `setInterval` every 10 s. A wall-clock tick also absorbs suspend/resume drift and manual clock changes; no reliance on a single long `setTimeout`.
- Each tick drains up to 25 due rows serially. Serial execution avoids two prompts racing into the same session.
- `nextDue()` powers the UI countdown and is `MIN(COALESCE(not_before, due_at))` over `pending|waiting`.
- Busy handling:
  - `wait` (default): recheck every 30 s until `wait_deadline` (default 30 min), then `missed`.
  - `steer`: send with `delivery: "steer"` into the active turn.
  - `skip`: mark `missed` immediately.
- New sessions: `POST /api/session` with title/directory/model/agent, persist `result_session_id` **before** prompting. If the prompt fails, the retry reuses the created session instead of creating another.
- Existing sessions: model is intentionally not switched. The schedule inherits the session's current model and agent.

## 7. Permissions

OpenCode `ask` rules block the turn until a reply. The gateway never globally auto-approves.

Per schedule:

| Policy | Behavior |
|---|---|
| `wait` (default) | Do nothing. The turn stays blocked; the UI shows a red pending state. |
| `reject` | After `permission_timeout_minutes`, reply `reject` with a clear message so the turn can finish. |
| `allow-readonly` | Reply `once` only for `read`, `glob`, `grep`, `list`, `skill`, `lsp`; everything else stays blocked. |
| `allow-all` | Reply `once` for every request. Dangerous; explicit opt-in only. |

The watchdog runs every 5 s only after a schedule is accepted, for `permission_timeout_minutes`, and stops itself. It filters by `sessionID`; it cannot approve a different session.

## 8. SSE

`EventHub` opens one `GET /api/event` connection with Basic auth and reconnects with exponential backoff (1 s → 30 s). It broadcasts parsed JSON events to:

- browser clients at `GET /api/events` (cookie auth);
- the scheduler's future extensions.

The browser endpoint adds `retry: 3000`, a 25 s comment heartbeat, and drops high-volume token deltas by default (`?deltas=1` opts in). OpenCode does not replay `Last-Event-ID`, so the client refetches messages on `session.execution.*` / `session.idle`.

## 9. Failure matrix

| Failure | Detected by | Result |
|---|---|---|
| Gateway restarts mid-send | `recover()` sees `sending` older than 120 s | `pending`; same id retried; `attempt >= 3` → `failed` |
| Gateway restarts while waiting | `wait_deadline < now` | `missed` |
| OpenCode offline at T-0 | health check / fetch error | retry every 60 s inside grace; then `missed` |
| OpenCode offline for hours | grace check on first pickup | `missed` without sending |
| Target session deleted | `404` from `getSession` | `failed`, no retry |
| Session busy | `/api/session/active` | `wait` / `steer` / `skip` |
| Permission prompt | permission poll | per-schedule policy |
| Duplicate id with different text | response id/text check | fail loudly; never send the wrong text |
| Browser offline | EventSource error | UI shows offline; poll fallback every 45 s |
| Clock jumps | 10 s wall-clock tick | next tick re-evaluates `due_at` |

## 10. Resource profile

- Node 22 baseline: ~40 MB RSS; this service with SQLite, HTTP and one SSE connection: **70–110 MB**, peaks ~150 MB.
- Package: ~150 KB (`npm pack`), no `node_modules`.
- DB: <1 MB per year at normal volume; 200-row UI page is <1 ms.
- systemd caps: `MemoryHigh=192M`, `MemoryMax=320M`, `PrivateTmp`, `ProtectSystem=strict`, `ReadWritePaths` limited to config/data.

## 11. Extension points

- Recurrence: add `recurrence` + `next_due_at`; the claim query already orders by due time.
- Notifications: emit from `schedule.failed` / `schedule.missed`; avoid adding a push service to the core.
- OpenCode plugin: a thin `/schedule` command can `POST /api/schedules` to the gateway. Do not move the timer into the plugin.
- Multi-instance: add an `instance_id` column and a per-instance client; the current auth model assumes one user.

## 12. Why not the alternatives

- **Inject into the OpenCode web UI**: its service worker caches `index.html`, its HTML is brotli-compressed, and CSP hashes the one inline script. `sub_filter` breaks on upgrades and does not survive the SW navigation cache. It also does not provide persistence.
- **OpenCode plugin only**: V2 plugins can subscribe to events and transform prompts, but cannot register HTTP routes, persist timers, or expose a mobile UI.
- **Fork the SPA**: 1.5 MB bundle, 4 routes, upstream changes every release; reimplementing the transcript renderer is weeks of work for near-zero marginal value.
- **CLI + systemd timers**: zero idle memory, but no list, no edit/cancel, no phone, no permission visibility.
