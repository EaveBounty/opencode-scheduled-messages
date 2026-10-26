# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

Open a **private** security advisory at
<https://github.com/EaveBounty/opencode-scheduled-messages/security/advisories/new>
or email the maintainer listed on the repository profile. Do not open a public issue with exploit details.

Please include:

- affected version and OS;
- whether the gateway was bound to loopback, LAN, or a public proxy;
- a minimal reproduction;
- impact (token leak, prompt injection into a session, unauthorized send, etc.).

We aim to acknowledge within 7 days.

## Threat model

The gateway is a **single-user local control plane**. It can send arbitrary text into your coding sessions, which may in turn run tools. Treat its access token like a shell credential.

| Threat | Mitigation |
|---|---|
| LAN attacker reads the token | Loopback default; HTTPS via Tailscale/Cloudflare; token never in URLs |
| XSS in a session title/message | All text escaped; CSP `script-src 'self'`; no `innerHTML` of raw content |
| CSRF from another origin | `SameSite=Strict` cookie + `Origin` check on every write |
| Token brute force | 24-byte random token, SHA-256 hash, constant-time compare, 10 attempts / 15 min / IP |
| OpenCode password leak | Read from `service.json`; injected server-side; never serialized to the browser or logs |
| Cookie theft | `HttpOnly`, `Secure` behind HTTPS, HMAC-signed expiry, rotation regenerates the cookie secret |
| Malicious session content | Rendered as text, no HTML; links restricted to `http(s)`; tool output in `<pre>` |
| Unattended tool execution | Permission policy defaults to `wait`; `allow-all` is explicit and labelled dangerous |
| Local disk leak | Config/DB `0600`, process `umask 077`, no `/tmp` storage |
| Resource exhaustion | systemd `MemoryHigh/Max`; serial scheduler; 64 KB request body cap |

## Out of scope

- Multi-tenant authorization; there is one user.
- Protecting a machine where the attacker already has your user account.
- OpenCode's own permission model or model-provider data handling.
- Public exposure without an additional auth layer (use Cloudflare Access, a VPN, or Tailscale).

## Operational checklist

- [ ] Gateway binds `127.0.0.1` unless you intentionally use `--lan`.
- [ ] Public access is behind HTTPS + an identity-aware proxy.
- [ ] `ocsched --rotate-token` after sharing a screen or suspecting a leak, then restart the service (`systemctl --user restart ocsched`).
- [ ] `OPENCODE_PASSWORD` is not committed; `service.json` is not copied into the repo.
- [ ] Permission policy is `wait` unless you have a specific reason.
- [ ] Back up `state.db` and keep it out of synced public folders.
