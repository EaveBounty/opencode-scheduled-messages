# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Fixed

- Sheet actions were bound to `#app` while the sheet lives in `#sheet-host`, so close, backdrop, quick-time and submit did nothing; delegated events now live on the sheet host.
- Scheduling feedback: submit shows a spinner, errors restore the button, and a successful schedule navigates to the visible queue.
- Subagent-only activity is mapped from child sessions to the root session, so the UI shows `子代理运行中` instead of `空闲`.
- Composer now has exactly two explicit actions: `立即发送` (confirmation sheet) and `定时发送` (time sheet); the misleading auto-send placeholder is gone.
- UI refresh: calmer paper/forest palette, clearer status strip, mobile-safe two-action composer, larger sheet close target.


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
- 40 tests with a fake OpenCode client; no network or LLM calls.

### Hardening

- Reconcile `408`/`409` against the durable inbox before retrying; never blind-retry an ambiguous prompt.
- Recover `sending` rows at startup and sweep stale sends every tick.
- Resume permission watchdogs for accepted schedules after a restart.
- Login rate limit counts failures only; successful logins no longer lock the IP out.
- Static JS/CSS is `no-cache`; service worker uses network-first for the shell and refuses to cache error responses.
- Mobile sheet survives live re-renders, traps focus, restores focus on close, and moves above the iOS keyboard.
- Bump `RestrictAddressFamilies` with `AF_NETLINK` so `os.networkInterfaces()` works inside the hardened systemd unit; interface enumeration no longer crashes startup.
- `--rotate-token` rotates and exits instead of trying to bind a second server; restart the service to apply it.
- Initial random password is printed once; it can be changed to a human-chosen password in Settings (scrypt, invalidates other sessions).

### Documentation

- README is Chinese by default; English moves to `README.en.md` with a language switch.
- GitHub Pages landing page auto-switches English/Chinese from `?lang`, stored preference, then `navigator.language`.

### Known limitations

- OpenCode V2 HTTP API is experimental.
- Single user, single instance.
- No recurring schedules, push notifications, or full diff/markdown renderer.
