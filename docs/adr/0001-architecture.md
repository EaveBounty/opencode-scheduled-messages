# ADR 0001 — Why a gateway instead of a plugin or UI injection

- Status: accepted
- Date: 2026-10-26
- Context: OpenCode V2.1.1

## Decision

Build a standalone, zero-dependency Node gateway that:

1. serves its own mobile PWA;
2. talks to OpenCode only through the documented V2 HTTP API;
3. persists one-shot schedules in SQLite;
4. deep-links to OpenCode's native UI for full transcript fidelity.

Do not fork OpenCode, do not inject scripts into its web UI, and do not put the scheduler inside an OpenCode plugin.

## Why

### Plugin

OpenCode V2 plugins run inside the shared server process and can subscribe to events, transform prompts, and add provider hooks. They **cannot register HTTP routes**, have no durable timer API, and their reload semantics are not a persistence mechanism. A plugin could not provide the mobile UI or survive a server restart with an at-least-once guarantee.

A plugin remains useful as a future thin client (`/schedule` writes to the gateway), but not as the scheduler.

### UI injection

The native web UI is a 1.5 MB SPA with:

- a service worker that caches `index.html` for navigations;
- brotli-compressed HTML, which defeats `sub_filter`;
- a CSP that hash-whitelists its one inline script;
- absolute `/_assets/` paths and `location.origin` API calls.

Injecting a button works in a demo and breaks on the next upgrade. It also provides no persistence, no offline retry, and no permission policy.

### Fork

Reimplementing markdown, code blocks, diffs, tool cards, image rendering and streaming is weeks of work for no marginal value. The native UI is already mobile-optimized and installable. A deep link is the correct amount of reuse.

### CLI + OS timers

`opencode run --session` + systemd timers is the smallest possible scheduler, but it cannot show a list, edit/cancel, explain a failure, or work from a phone. It also shells out per run and has no idempotency across retries.

## Consequences

- We depend on an API explicitly marked experimental. Mitigation: capability probe (`/api/info`), contract tests, pin/doctor workflow.
- Two processes instead of one; ~100 MB extra RSS. Acceptable versus OpenCode's ~400 MB.
- The PWA needs HTTPS for installation; Tailscale is the zero-cost path.
- The compact transcript deliberately omits tool UI fidelity; the native deep link is one tap away.

## Revisit when

- OpenCode ships native scheduled messages or a durable timer API.
- OpenCode plugins gain HTTP route registration and persistent job storage.
- The V2 HTTP API is removed or becomes incompatible.
