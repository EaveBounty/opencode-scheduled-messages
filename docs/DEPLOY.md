# Deploy

## 0. Preconditions

- Node.js ≥ 22.6 (for `node:sqlite` and native `fetch`).
- OpenCode V2 reachable over HTTP, normally `http://127.0.0.1:4096`.
- A config source for the OpenCode password: `~/.config/opencode/service.json` (default) or `OPENCODE_PASSWORD`.
- The data directory must be on persistent disk. **Never use `/tmp`**: on memory-backed tmpfs a full `/tmp` can exhaust RAM and takes the whole machine down with OpenCode.

Check everything:

```bash
ocsched doctor
```

Exit code `2` means the OpenCode health check failed. `doctor` never writes anything.

## 1. Local systemd (recommended on a home server)

```bash
ocsched service print > ~/.config/systemd/user/ocsched.service
systemctl --user daemon-reload
systemctl --user enable --now ocsched
systemctl --user status ocsched
journalctl --user -u ocsched -f
```

The unit:

- binds `127.0.0.1:8788`;
- restarts on failure;
- caps memory at 192–320 MB;
- restricts the filesystem to the config/data directories;
- keeps the server independent of the OpenCode process.

For a LAN-only install, edit `ExecStart` and add `--lan` (or `--bind 0.0.0.0`). Do not expose it to the public internet without HTTPS and an auth layer.

If the user session does not linger after logout:

```bash
sudo loginctl enable-linger "$USER"
```

## 2. Phone over Tailscale

Tailscale gives a real HTTPS certificate on a `*.ts.net` name, which makes the PWA installable and the service worker usable.

```bash
# PWA
tailscale serve --bg --https=443 http://127.0.0.1:8788

# OpenCode native UI (optional but recommended)
tailscale serve --bg --https=8443 http://127.0.0.1:4096

tailscale serve status
```

In the app: **Settings → OpenCode native URL** = `https://<host>.<tailnet>.ts.net:8443`.

Why two ports? OpenCode's SPA uses `location.origin` and absolute `/_assets/` paths, so it cannot be mounted under a subpath. A second HTTPS port keeps both apps at their own origin and avoids proxy rewrites and service-worker conflicts.

If you only have one port, skip the native UI proxy and open `http://<tailscale-ip>:4096` manually; the PWA still works, but its full-session button must be configured accordingly.

## 3. Cloudflare Tunnel

Create two public hostnames:

| Hostname | Service |
|---|---|
| `schedule.example.com` | `http://127.0.0.1:8788` |
| `opencode.example.com` | `http://127.0.0.1:4096` |

Then set **Settings → OpenCode native URL** to `https://opencode.example.com`.

Security:

- Put **Cloudflare Access** in front of both hostnames. The gateway has a single access token, not multi-user accounts.
- Do not enable a public tunnel without Access; the API can send prompts into your coding sessions.
- SSE works through Cloudflare, but keep proxy buffering off if you add nginx in front.

## 4. nginx

```nginx
server {
    listen 443 ssl http2;
    server_name schedule.example.com;

    # TLS config omitted

    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

`proxy_buffering off` is required for `/api/events`; otherwise the UI appears frozen until the buffer flushes. The gateway already sends `X-Accel-Buffering: no`.

## 5. Docker (optional)

There is no official image yet. A minimal image is easy because there are no dependencies:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY public ./public
ENV OCSM_DATA_DIR=/data
ENV OCSM_CONFIG_DIR=/config
VOLUME ["/data", "/config"]
EXPOSE 8788
CMD ["node", "bin/ocsched.js", "--bind", "0.0.0.0", "--port", "8788"]
```

Mount the OpenCode `service.json` read-only, or set `OPENCODE_PASSWORD` / `OPENCODE_BASE_URL`. Do not bake secrets into the image.

## 6. Reverse proxy compatibility matrix

| Proxy | SSE | Notes |
|---|---|---|
| Tailscale Serve | ✅ | Native, no buffering, real cert |
| Cloudflare Tunnel | ✅ | Add Access; avoid aggressive caching |
| nginx | ✅ with `proxy_buffering off` | `proxy_read_timeout 3600s` |
| Caddy | ✅ | `reverse_proxy` streams by default |
| Traefik | ✅ | Disable response buffering middleware |

## 7. Upgrades

```bash
npm install -g opencode-scheduled-messages@latest
systemctl --user restart ocsched
ocsched doctor
```

The SQLite schema is additive (`CREATE TABLE IF NOT EXISTS`). Back up `~/.local/share/opencode-scheduled-messages/state.db` before major upgrades.

OpenCode V2's API is marked experimental. If a release changes a route or payload:

1. `ocsched doctor` shows the upstream version and health.
2. `journalctl --user -u ocsched -n 100` shows the failing path and tag.
3. Pin the last known-good gateway version; open an issue with the OpenCode version.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| `401 unauthorized` in the UI | Token rotated; run `ocsched --rotate-token`, restart the service, paste the new token |
| `OpenCode rejected the gateway credentials` | `service.json` password changed; restart `ocsched` |
| Sessions list empty | OpenCode has no root sessions, or `includeChildren` is off and only child sessions exist |
| Queue never fires | `systemctl --user status ocsched`; `ocsched doctor`; clock/timezone |
| Message marked `waiting` forever | Target session is running; increase wait or choose steer |
| `missed` after boot | Outside the 120-minute grace; use **重发** |
| PWA install button missing | Not HTTPS; use Tailscale/Cloudflare; iOS uses Share → Add to Home Screen |
| SSE disconnected | Proxy buffering; check `/api/health` and `journalctl` |
| High memory | `systemctl --user show ocsched -p MemoryCurrent`; the cap is 320 MB |
