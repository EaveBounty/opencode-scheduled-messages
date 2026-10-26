# Gateway API

All routes are same-origin. Browser auth is a signed `ocsm_session` cookie; automation can use `Authorization: Bearer <password>` (a legacy token still works). Cookie-authenticated writes must send a matching `Origin`.

Errors are `{ "error": { "code": "...", "message": "...", "details"?: ... } }`.

## Auth

### `GET /api/auth/status`

```json
{ "authenticated": true, "via": "cookie" }
```

### `POST /api/auth/login`

```json
{ "token": "the token printed by ocsched" }
```

Response sets the cookie. Rate limit: 10 attempts / 15 min / IP.

### `POST /api/auth/logout`

Clears the cookie.

## Read-through

### `GET /api/sessions?limit=50&order=desc&search=&includeChildren=0`

Returns OpenCode's `{ data, cursor }` unchanged. Root sessions only unless `includeChildren=1`.

### `GET /api/sessions/:id`

Returns `{ data: Session }`.

### `GET /api/sessions/:id/messages?limit=30&order=desc`

Returns a compact transcript:

```json
{
  "data": [
    {
      "id": "msg_...",
      "type": "assistant",
      "created": 1792988473368,
      "agent": "build",
      "model": { "id": "deepseek-v4.1-flash", "providerID": "opencode-go", "variant": "high" },
      "parts": [
        { "kind": "reasoning", "text": "..." },
        { "kind": "text", "text": "..." },
        { "kind": "tool", "name": "shell", "status": "completed", "output": "..." }
      ],
      "cost": 0.001,
      "tokens": { "input": 374, "output": 644 }
    }
  ],
  "cursor": null
}
```

### `POST /api/sessions/:id/send`

Immediate manual send (bypasses the queue):

```json
{ "text": "one line", "delivery": "steer" }
```

Response: `{ "data": { "messageID": "msg_..." } }`.

### `GET /api/sessions/:id/deep-link`

```json
{ "url": "https://host.ts.net:8443/server/<base64url(origin)>/session/ses_..." }
```

### Other read routes

`GET /api/projects`, `/api/models`, `/api/agents`, `/api/active`, `/api/permissions`, `/api/state`, `/api/settings`, `/api/health`.

## Schedules

### `GET /api/schedules?state=pending,waiting&limit=200&offset=0`

```json
{
  "data": [
    {
      "id": "sch_...",
      "target": {
        "kind": "session",
        "sessionID": "ses_...",
        "directory": "/home/me/project",
        "title": "Session title",
        "agent": "build",
        "model": null
      },
      "text": "check this tomorrow",
      "dueAt": 1793075626935,
      "dueAtISO": "2026-10-27T04:33:46.935Z",
      "timezone": "Asia/Shanghai",
      "state": "pending",
      "busyPolicy": "wait",
      "waitMinutes": 30,
      "graceMinutes": 120,
      "permissionPolicy": "wait",
      "permissionTimeoutMinutes": 10,
      "attempt": 0,
      "messageID": "msg_...",
      "resultSessionID": null,
      "resultMessageID": null,
      "lastError": null,
      "active": true
    }
  ],
  "stats": { "pending": 1, "accepted": 0, "missed": 0 },
  "nextDue": 1793075626935
}
```

### `POST /api/schedules`

```json
{
  "text": "one sentence",
  "dueAt": 1793075626935,
  "timezone": "Asia/Shanghai",
  "target": { "kind": "session", "sessionID": "ses_..." },
  "busyPolicy": "wait",
  "waitMinutes": 30,
  "graceMinutes": 120,
  "permissionPolicy": "wait",
  "permissionTimeoutMinutes": 10
}
```

New-session target:

```json
{
  "text": "one sentence",
  "dueAt": 1793075626935,
  "target": {
    "kind": "new",
    "directory": "/home/me/project",
    "title": "Night idea"
  },
  "model": { "providerID": "opencode-go", "id": "deepseek-v4.1-flash" },
  "agent": "build"
}
```

`dueAt` may be epoch milliseconds or an ISO string. A time more than 60 s in the past is rejected; use `send-now`. Returns `201 { data: Schedule }`.

### `PATCH /api/schedules/:id`

Editable only in `pending` / `waiting`. Fields: `text`, `dueAt`, `timezone`, `busyPolicy`, `waitMinutes`, `graceMinutes`, `permissionPolicy`, `permissionTimeoutMinutes`, `title`, `agent`, and `directory` (new-session targets only). Editing resets the row to `pending` and clears wait fields.

### `DELETE /api/schedules/:id`

Cancels `pending`, `waiting`, `missed`, `failed`. Returns the updated row.

### `POST /api/schedules/:id/send-now`

Sends at the next tick. Pending/waiting rows keep their idempotency key; already-sent rows get a fresh `msg_` id (manual resend).

### `POST /api/schedules/:id/retry`

Only `failed` / `missed`. Generates a fresh `msg_` id.

### `GET /api/schedules/:id/runs`

Audit trail of attempts: `{ data: [{ attempt, started_at, ended_at, status, http_status, error }] }`.

## Events

### `GET /api/events?session=<id>&deltas=0`

Server-sent events:

```
retry: 3000

data: {"type":"hello","upstream":{"connected":true},"stats":{...},"nextDue":...}

data: {"type":"schedule.accepted","schedule":{...},"sessionID":"ses_..."}

data: {"type":"session.execution.started","sessionID":"ses_..."}
```

Token deltas are dropped unless `deltas=1`. The connection sends `: ping` every 25 s. OpenCode does not replay events, so refetch state after reconnecting.

## Settings

### `PATCH /api/settings`

```json
{
  "defaults": {
    "timezone": "Asia/Shanghai",
    "busyPolicy": "wait",
    "waitMinutes": 30,
    "graceMinutes": 120,
    "permissionPolicy": "wait",
    "permissionTimeoutMinutes": 10
  },
  "publicUrl": "https://schedule.example.com",
  "opencodePublicUrl": "https://opencode.example.com"
}
```

The gateway's own public URL is used for origin checks; `opencodePublicUrl` is used for native deep links. Neither is required for LAN-only use.
