# Contributing

Thanks for helping. This project is deliberately small; the bar for new runtime dependencies is very high.

## Ground rules

- **Zero runtime dependencies.** Use Node built-ins (`node:http`, `node:sqlite`, `fetch`, `node:crypto`). A new dependency needs a written justification in an ADR.
- **No build step.** Plain ESM + JSDoc, vanilla HTML/CSS/JS. `npm test` must run without `npm install`.
- **Do not modify OpenCode.** Integrate through the V2 HTTP API only.
- **Keep the mobile path first.** Test at 390×844; no horizontal overflow; 44 px targets.
- **Never auto-approve permissions by default.** `allow-all` must remain an explicit per-schedule choice.

## Development

```bash
git clone https://github.com/EaveBounty/opencode-scheduled-messages.git
cd opencode-scheduled-messages
npm test                 # 39 tests, no network
node bin/ocsched.js --help
```

To run against a real OpenCode:

```bash
OCSM_TOKEN=dev-token node bin/ocsched.js --port 8788
# open http://127.0.0.1:8788, paste dev-token
```

Use a throwaway schedule and cancel it. Do not send real prompts in tests; use the fake client in `test/fake-client.js`.

## Before opening a PR

```bash
npm test
node --check bin/ocsched.js
node --check src/main.js
node --check public/app.js
npm pack --dry-run
```

Checklist:

- [ ] New state transition has a unit test with an injected clock.
- [ ] New HTTP route has auth + Origin behavior covered.
- [ ] New UI text is in Chinese (English brand names are fine).
- [ ] Empty, loading, error and offline states exist.
- [ ] `README.md` and `README.zh-CN.md` updated if behavior changed.
- [ ] `CHANGELOG.md` has one line under `Unreleased`.

## Commit style

Conventional-ish, imperative, scoped:

```
feat(scheduler): wait for idle before sending
fix(http): reject cookie writes without Origin
docs(readme): clarify opencode-go quota math
```

## Design

Read `DESIGN.md` before touching `public/app.css` or adding a screen. Reuse tokens; do not introduce a second accent or a component library.

## Security

Do not include real tokens, `service.json`, session dumps, or personal screenshots in issues/PRs. See `SECURITY.md`.

## License

Contributions are accepted under the project's PolyForm Noncommercial 1.0.0 license.
