# opencode-scheduled-messages

**Schedule a message into an existing OpenCode V2 session — write at peak, send off-peak.**

[Website](https://eavebounty.github.io/opencode-scheduled-messages/) · [npm](https://www.npmjs.com/package/opencode-scheduled-messages) · [Architecture](docs/ARCHITECTURE.md) · [Deploy](docs/DEPLOY.md)

[![CI](https://github.com/EaveBounty/opencode-scheduled-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/EaveBounty/opencode-scheduled-messages/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-scheduled-messages.svg)](https://www.npmjs.com/package/opencode-scheduled-messages)
[![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.6-339933.svg)](https://nodejs.org)

OpenCode V2 is excellent at keeping a thread, but it has no scheduler. Existing tools create a **new** session for every job, so the idea loses the context you were actually thinking in. This project does the opposite: it queues a message for **a specific existing session** (or a new one), and sends it later through the official V2 HTTP API.

It is a single zero-dependency Node process, a mobile-first PWA, and a SQLite queue. No fork of OpenCode, no browser automation, no injected scripts, no 900 MB database reads.

```
┌─────────────┐   HTTPS/Tailscale   ┌──────────────────────────┐
│ phone / PC  │ ──────────────────► │ ocsched :8788            │
│  PWA        │                     │  ├─ /          our PWA   │
└─────────────┘                     │  ├─ /api/*     gateway   │
                                    │  └─ scheduler + SQLite   │
                                    └────────────┬─────────────┘
                                                 │ Basic auth (server-side)
                                                 ▼
                                    ┌──────────────────────────┐
                                    │ OpenCode V2 :4096        │
                                    │  native web UI + API     │
                                    └──────────────────────────┘
```

---

## Why this exists

OpenCode V2 exposes a first-class HTTP API (`POST /api/session/{id}/prompt`), but no cron or delayed-send primitive. A naive `setTimeout` in a browser tab dies when the phone sleeps. A plugin cannot register HTTP routes or persist a timer across restarts. Wrapping `opencode run` loses the existing thread and the UI.

`opencode-scheduled-messages` is the small missing layer:

- **Existing session, not a new one.** The prompt is appended to the session you choose.
- **Durable.** SQLite + a single 10-second tick; survives restarts and catches up inside a grace window.
- **Honest about failure.** Busy sessions wait, offline servers retry, stale ideas become `missed` instead of silently firing at noon.
- **Phone-first.** A ~80 KB PWA, bottom composer, safe-area support, installable over HTTPS.
- **Full-fidelity view when you need it.** One tap opens OpenCode's own native session UI through a deep link.
- **Zero runtime dependencies.** `node:http`, `node:sqlite`, native `fetch`. `npm pack` is ~150 KB.

## Features

| | |
|---|---|
| **Session browser** | Lists root sessions from every project, shows running/idle, model, last activity, cost and tokens. |
| **Existing-session send** | `POST /api/session/{id}/prompt` with a client-generated `msg_` id for idempotency. |
| **New-session send** | Creates a session with title, directory, model and agent, then sends the message. |
| **One-shot scheduling** | Absolute UTC time + original IANA timezone; the phone's timezone is used at creation. |
| **Busy policy** | Wait up to 30 minutes for idle (default), steer into the current turn, or skip. |
| **Grace window** | If the machine was off, send only within 120 minutes; otherwise mark `missed` for manual resend. |
| **Permission policy** | Per schedule: wait for you (default), auto-reject on timeout, auto-approve read-only tools, or explicitly allow all. |
| **Live updates** | SSE fan-out from OpenCode; scheduler events are pushed to every browser. |
| **Mobile PWA** | Manifest, service worker, dark/light tokens, 44 px targets, iOS safe areas, install prompt. |
| **LAN / Tailscale / Cloudflare** | Loopback by default, `--lan` for a phone on the same Wi-Fi, or put any HTTPS reverse proxy in front. |
| **DeepSeek peak hint** | Shows whether the chosen time is DeepSeek peak or off-peak (official UTC windows). |

## Quick start

Requirements: **Node.js ≥ 22.6** and a running **OpenCode V2** server.

```bash
# 1. Start OpenCode's server if it is not already running.
opencode serve --service          # usually already active as opencode.service

# 2. Start the scheduler.
npx opencode-scheduled-messages

# Or install it globally:
npm install -g opencode-scheduled-messages
ocsched
```

On first run it prints a one-time access token:

```
────────────────────────────────────────────────────────────────
  Access token (shown once; store it now)
  Xq3...your-token...
  Config: ~/.config/opencode-scheduled-messages/config.json
  Lost it? Run with --rotate-token to issue a new one.
────────────────────────────────────────────────────────────────
```

Open <http://127.0.0.1:8788>, paste the token, pick a session, write a sentence, choose **今晚 23:30**, and submit. At 23:30 the message is appended to that session.

### Phone on the same Wi-Fi

```bash
ocsched --lan
# Local     http://127.0.0.1:8788
# LAN       http://192.168.x.x:8788
```

Open the LAN URL on the phone. HTTP works, but service workers and PWA installation need a secure context — use one of the HTTPS options below.

### Tailscale (recommended for daily use)

```bash
# Gateway PWA on 443
tailscale serve --bg --https=443 http://127.0.0.1:8788

# OpenCode's native UI on 8443 (for one-tap full-session links and its own PWA)
tailscale serve --bg --https=8443 http://127.0.0.1:4096
```

Then in **Settings → OpenCode native URL**, set `https://<host>.<tailnet>.ts.net:8443`. Now the PWA is installable on iOS/Android, and **Open full session** opens the real OpenCode UI, not a clone.

### Cloudflare Tunnel / nginx

Any reverse proxy works. Expose two hostnames (or two ports):

- `https://schedule.example.com` → `127.0.0.1:8788`
- `https://opencode.example.com` → `127.0.0.1:4096`

Set **Settings → OpenCode native URL** to the second one. Put Cloudflare Access or your own auth in front; this app is single-user and does not implement multi-tenant auth.

> SSE needs proxy buffering off. For nginx: `proxy_buffering off; proxy_read_timeout 3600s;`.

### systemd (survive reboot)

```bash
ocsched service print > ~/.config/systemd/user/ocsched.service
systemctl --user daemon-reload
systemctl --user enable --now ocsched
journalctl --user -u ocsched -f
```

The generated unit binds to `127.0.0.1` by default and caps memory (`MemoryHigh=192M`, `MemoryMax=320M`) so it can never compete with OpenCode for the whole machine.

## How it works

1. The gateway reads the OpenCode password from `~/.config/opencode/service.json` (or `OPENCODE_PASSWORD`) and injects Basic auth **server-side**. The browser never receives it.
2. The PWA lists sessions through the gateway. Choosing one stores `{sessionID, text, dueAt, timezone, policies}` in SQLite.
3. A 10-second tick claims the next due row with an atomic `UPDATE ... WHERE state = 'pending'`.
4. At T-0 the scheduler checks OpenCode health, target session existence and active state, then calls `POST /api/session/{id}/prompt` with a stable `msg_` id.
5. The same id is reused on retries. OpenCode returns the original message for a duplicate id, so a retry cannot send the sentence twice.
6. The UI receives `schedule.accepted` / `schedule.failed` over SSE.

Full details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### State machine

```
pending ──► sending ──► accepted (sent)
                                  └── done (reserved)
   │           │
   │           ├──► pending   (transient error, same msg id)
   │           ├──► missed    (grace expired / stayed busy)
   │           └──► failed    (permanent 4xx)
   ├──► waiting ──► sending   (session was busy)
   └──► cancelled
```

### Idempotency and “did it actually send?”

`200 OK` means OpenCode accepted the prompt into its inbox, not that the model finished. The UI labels that as **已发送 / accepted** (terminal in 0.1). Execution progress is visible in the native session or through live SSE events. If OpenCode was offline, nothing was sent and the retry is safe. If a request times out after the server accepted it, reusing the same `msg_` id returns the original message instead of duplicating it.

## DeepSeek peak / off-peak

DeepSeek's official API applies **half price during off-peak hours**. Peak hours are **01:00–04:00 and 06:00–10:00 UTC, Monday–Friday**, excluding Chinese public holidays. In Beijing time that is **09:00–12:00 and 14:00–18:00 on weekdays**; evenings, lunch, weekends and holidays are off-peak.

Source: <https://api-docs.deepseek.com/quick_start/pricing>

If you use **opencode-go**, you pay a subscription rather than per token, but its monthly allowance is denominated in dollars and DeepSeek's peak token price is exactly twice the off-peak price. Sending at off-peak therefore consumes **half the allowance** for the same tokens — useful when you hit the 5-hour/weekly caps, but it does not reduce the monthly subscription price. The UI says **“谷时 · 半额消耗”**, not “save 50%”, because that distinction matters.

## Comparison

| | **this project** | opencode-scheduler | opencode-manager |
|---|---|---|---|
| Append to an **existing** session | ✅ | ❌ (new session per run) | ❌ (new session per run) |
| Durable queue + missed-run policy | ✅ SQLite + grace window | ⚠️ OS scheduler; no retry in practice | ⚠️ DB jobs; cron mode has no catch-up |
| Mobile UI | ✅ PWA + native deep link | ❌ | ✅ web |
| Runtime footprint | ~100 MB RSS, 0 deps, ~150 KB package | plugin + OS timers | Bun + React + Docker, ≥1.5 GB image |
| Permission control for unattended sends | ✅ per schedule | ⚠️ denies questions | ❌ |
| Works without systemd | ✅ | ✅ (cron/launchd) | ✅ (Docker) |

The point is not “more features”. It is the specific missing primitive: **a delayed prompt into a thread that already exists**.

## Security model

- Binds `127.0.0.1` by default. `--lan` is an explicit opt-in.
- Access token is printed once, stored as a SHA-256 hash; the browser gets a signed `HttpOnly; SameSite=Strict` cookie.
- Writes require a matching `Origin`; login is rate-limited.
- The OpenCode password stays in the gateway process. It is never serialized into HTML or sent to the browser.
- CSP is `default-src 'self'` with no inline scripts; all user text is escaped before rendering.
- Config and DB are written with `0600`, and the DB lives in `~/.local/share/`, never `/tmp`.
- Unattended permission requests default to **wait**, not auto-approve. Auto-approving shell/edit is opt-in per schedule and clearly labelled dangerous.

See [`SECURITY.md`](SECURITY.md).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENCODE_BASE_URL` | from `service.json` | OpenCode HTTP API, e.g. `http://127.0.0.1:4096` |
| `OPENCODE_PASSWORD` | from `service.json` | Basic auth password; prefer the file |
| `OCSM_TOKEN` | generated | Fixed access token (containers/tests) |
| `OCSM_CONFIG_DIR` | `~/.config/opencode-scheduled-messages` | Config directory |
| `OCSM_DATA_DIR` | `~/.local/share/opencode-scheduled-messages` | SQLite directory |

CLI flags: `--port`, `--bind`, `--lan`, `--public-url`, `--opencode-url`, `--opencode-public-url`, `--rotate-token`, `--log-level`.

## API

The gateway exposes a small same-origin API for the PWA:

```
GET    /api/sessions
GET    /api/sessions/:id/messages
POST   /api/sessions/:id/send
GET    /api/sessions/:id/deep-link
GET    /api/schedules
POST   /api/schedules
PATCH  /api/schedules/:id
DELETE /api/schedules/:id
POST   /api/schedules/:id/send-now
POST   /api/schedules/:id/retry
GET    /api/events            (SSE)
```

See [`docs/API.md`](docs/API.md) for bodies and examples.

## FAQ

### Does OpenCode support scheduled messages or cron?

Not natively in V2.1. It has a durable inbox (`delivery: queue`) but no timer: a queued item does not wake itself. This project supplies the timer and persists it outside the OpenCode process.

### Can I send a prompt to an existing OpenCode session?

Yes. That is the core operation: `POST /api/session/{sessionID}/prompt`. The scheduler stores the session id and appends the message when due.

### What happens if my computer is asleep at the scheduled time?

The job stays `pending` and retries while OpenCode is unreachable. On restart, it sends only if it is within the 120-minute grace window; otherwise it becomes `missed` and waits for a manual **resend**. This avoids firing a stale idea at the wrong time.

### What if the session is busy?

Default: wait for idle, re-checking every 30 seconds, up to 30 minutes. Then mark it `missed`. You can choose **steer** (inject into the current turn) or **skip** per schedule.

### Does it work with DeepSeek off-peak pricing?

Yes, and it shows the official peak/off-peak windows. On a pay-as-you-go DeepSeek key, off-peak is half price. On opencode-go, it halves the allowance consumed rather than the subscription price.

### Is it a plugin? Do I need to modify OpenCode?

No. OpenCode V2 plugins cannot register HTTP routes or provide a durable scheduler, so the reliable design is a separate process using the public API. OpenCode itself is untouched.

### Does it work on a phone?

Yes. Use `--lan` for quick access, or Tailscale/Cloudflare for an installable HTTPS PWA. The session view is a compact transcript; **Open full session** hands off to OpenCode's own mobile-optimized web UI.

### Is there a recurring schedule?

Not in 0.1. The data model has room for it, but one-shot is deliberate: the use case is “this thought, tonight”, not “a cron job that keeps spending tokens”.

## Limitations

- Single-user, single OpenCode instance. No multi-tenant accounts.
- OpenCode V2's HTTP API is marked experimental; pin a known version and run `ocsched doctor` after upgrades.
- The compact transcript is not a full Markdown/diff renderer. Use the native deep link for tool output, diffs and images.
- No push notification channel yet; the PWA badge and queue status are the feedback loop.
- Auto-approving permissions is inherently risky. The default is to wait.

## Development

```bash
git clone https://github.com/EaveBounty/opencode-scheduled-messages.git
cd opencode-scheduled-messages
npm test                 # 39 tests, no network, no dependencies
node bin/ocsched.js --help
```

Source layout: `src/store.js` (SQLite), `src/scheduler.js` (state machine), `src/http.js` (gateway), `src/opencode.js` (API client), `public/` (PWA).

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use requires a separate license; open an issue to discuss.

---

**Keywords:** OpenCode scheduled messages, OpenCode scheduler, OpenCode cron, OpenCode V2 prompt API, send prompt to existing OpenCode session, DeepSeek off-peak, OpenCode mobile PWA, self-hosted AI coding scheduler, Tailscale OpenCode, Cloudflare Tunnel OpenCode.
