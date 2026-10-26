# SEO / GEO checklist

The goal is not keyword stuffing. It is that someone searching for the exact
missing primitive lands here, and that an AI answer engine can quote the project
accurately.

## 1. Naming

Repository and npm package: **`opencode-scheduled-messages`**.

Why:

- exact phrase match for “opencode scheduled messages”;
- contains “opencode” for every related query;
- unambiguous next to `opencode-scheduler` (existing, new-session-only) and
  `opencode-manager` (heavy Docker UI);
- free on both npm and GitHub at the time of writing.

Internal service name: `ocsched` (short CLI). Do not rename the repo to `ocsched`;
nobody searches that.

## 2. Target queries and where they are answered

| Query | Intent | Location |
|---|---|---|
| `opencode scheduled messages` | exact product | repo name, H1, npm keywords |
| `opencode scheduler` | category | H1, description, comparison table |
| `opencode cron` | category | FAQ “Does OpenCode support cron?” |
| `send prompt to existing opencode session` | core primitive | H2 “Why this exists”, API section |
| `opencode run --session schedule` | CLI alternative | comparison table, ADR |
| `opencode deepseek off-peak` | pricing | “DeepSeek peak / off-peak” |
| `opencode mobile pwa` | mobile | Features, DEPLOY |
| `opencode tailscale` | deployment | Quick start, DEPLOY |
| `opencode plugin scheduler` | integration | FAQ “Is it a plugin?” |
| `opencode v2 api prompt` | developer | docs/API.md |

## 3. GitHub repository settings

- Description (≤350 chars): use the first sentence of the README, including
  “existing OpenCode V2 sessions”, “off-peak”, “self-hosted PWA”.
- Topics (20 max): `opencode`, `opencode-v2`, `opencode-scheduler`,
  `scheduled-messages`, `cron`, `task-scheduler`, `deepseek`, `off-peak`,
  `pwa`, `mobile`, `self-hosted`, `tailscale`, `cloudflare-tunnel`, `sqlite`,
  `nodejs`, `zero-dependencies`, `ai-coding`, `coding-agent`, `automation`,
  `developer-tools`.
- Social preview: upload `docs/social-preview.png` (1280×640).
- Pin the repository on the organization profile.
- Enable Discussions and Issues.
- Releases: tag `v0.1.0`, generate notes, attach the npm tarball.

## 4. npm

`package.json` already contains:

- `description` with the primary phrase;
- `keywords` (18);
- `repository`, `homepage`, `bugs`;
- `license`;
- `engines`.

After publish:

- verify the npm page renders the README and keywords;
- add the npm badge to the README (done);
- publish a `next` tag for prereleases, never overwrite a version.

## 5. Content that earns links

- A concrete comparison table against the two closest projects, with honest
  “they do X better” notes.
- A reproducible architecture note (`docs/ARCHITECTURE.md`) with the API route,
  state machine and failure matrix.
- A real mobile screenshot (no mockups) and a 20-second demo GIF.
- A “DeepSeek quota math” section that corrects the common “off-peak saves 50%”
  claim for subscription users. This is quotable and specific.

## 6. Distribution (manual, no spam)

- Submit to OpenCode community lists / awesome-opencode if one exists.
- One Show HN / Reddit post with the concrete use case, not a generic “please star”.
- Reply to issues in `opencode-scheduler` / `opencode-manager` only when the
  existing-session limitation is directly relevant.
- Link from the company site/project index.

## 7. GEO (AI answer engines)

- `llms.txt` at the repo root: short, factual, canonical URLs.
- Keep the README’s first 200 words self-contained: what it is, who it is for,
  the one differentiator, the install command.
- Use explicit “X is / X is not” statements (plugin? fork? multi-user?) so
  retrieval does not guess.
- Avoid unverifiable claims (“blazing fast”); use measured numbers (RSS, package
  size, test count).
- Date the compatibility claim (`OpenCode V2.1.x`, 2026-10).

## 8. Measurement

- GitHub: search impressions, clone counts, referrers.
- npm: weekly downloads, version adoption.
- Issues: which query the user came from (add a “How did you find this?” field).
- Revisit keywords after 30 days; remove any topic that does not describe the
  product.
