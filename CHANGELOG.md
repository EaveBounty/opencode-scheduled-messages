# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.1.0] — 2026-10-26

Initial release.

### Added

- Session browser for OpenCode V2 (root/child sessions, project filter, search, running state).
- One-shot scheduling into an **existing** session via `POST /api/session/{id}/prompt`.
- New-session scheduling with title, directory, model and agent.
- SQLite queue with idempotent `msg_` ids, WAL, crash recovery and a 10-second tick.
- Busy policies: wait (30 min default), steer, skip.
- Grace window (120 min default) with `missed` instead of stale sends.
- Per-schedule permission policies: wait, reject, allow-readonly, allow-all.
- Mobile-first PWA: manifest, service worker, dark/light tokens, safe areas, install prompt.
- Compact transcript + native OpenCode deep link.
- SSE gateway with reconnect and heartbeat.
- Server-side Basic auth injection; access-token login; CSRF origin checks; CSP.
- `ocsched doctor`, `ocsched service print|install`, systemd unit with memory caps.
- DeepSeek peak/off-peak hint (official UTC windows).
- 39 tests with a fake OpenCode client; no network or LLM calls.

### Hardening

- Reconcile `408`/`409` against the durable inbox before retrying; never blind-retry an ambiguous prompt.
- Recover `sending` rows at startup and sweep stale sends every tick.
- Resume permission watchdogs for accepted schedules after a restart.
- Login rate limit counts failures only; successful logins no longer lock the IP out.
- Static JS/CSS is `no-cache`; service worker uses network-first for the shell and refuses to cache error responses.
- Mobile sheet survives live re-renders, traps focus, restores focus on close, and moves above the iOS keyboard.

### Known limitations

- OpenCode V2 HTTP API is experimental.
- Single user, single instance.
- No recurring schedules, push notifications, or full diff/markdown renderer.
