# DESIGN.md — opencode-scheduled-messages

> Visual source of truth for the PWA. Read this before changing `public/app.css`
> or adding a screen. Inspiration: **Linear / Vercel devtool** — quiet surfaces,
> one electric accent, dense but breathable information, no decorative gradients
> except a single primary action.

## 1. Art direction

- **Mood:** late-night engineering console. Calm, precise, slightly warm light mode.
- **Density:** compact lists, 14–15 px body, 11–12 px metadata.
- **Depth:** 1 px borders and subtle raised surfaces; no heavy shadows except sheets and primary buttons.
- **Motion:** 120–200 ms, only for state changes; respect `prefers-reduced-motion`.
- **Never:** pure black `#000`, neon glows, rainbow badges, drop shadows on every card, icon fonts.

## 2. Color tokens

Defined in `public/app.css` as CSS custom properties. Dark is the default; light follows `prefers-color-scheme`.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0b0d12` | `#f6f7fb` | page |
| `--bg-elev` | `#11151f` | `#ffffff` | cards, bubbles |
| `--bg-elev-2` | `#171c28` | `#eef1f7` | hover, segmented control |
| `--bg-input` | `#0d1119` | `#ffffff` | inputs, code |
| `--text` | `#eef1f8` | `#161a23` | primary text |
| `--muted` | `#9aa3b5` | `#5d6577` | secondary text |
| `--faint` | `#6b7488` | `#8a92a3` | metadata, placeholders |
| `--border` | `rgba(255,255,255,.09)` | `rgba(10,15,30,.09)` | hairlines |
| `--accent` | `#6f8cff` | `#3b5cf6` | links, active tab, focus |
| `--accent-strong` | `#3b5cf6` | `#2f4ce0` | primary button end |
| `--accent-soft` | `rgba(111,140,255,.14)` | `rgba(59,92,246,.10)` | selection, notices |
| `--green` | `#43d19e` | `#0f9f71` | running, success |
| `--amber` | `#f5b84f` | `#b77600` | waiting, peak hours |
| `--red` | `#ff6b7a` | `#d63b4c` | failed, destructive |
| `--shadow` | `0 18px 50px rgba(0,0,0,.38)` | `0 18px 50px rgba(20,30,60,.14)` | sheets only |

Rules:
- Accent is reserved for **one** primary action per view, active nav, focus rings and “off-peak” hints.
- Status colors are never the only signal: pair with text (`运行中`, `已错过`, `谷时`).
- Message text is always high-contrast `--text`; assistant bubbles use `--bg-elev`, user bubbles use the accent gradient.

## 3. Typography

```
--font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
--mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
```

| Role | Size / weight | Notes |
|---|---|---|
| Page title | 22 / 700 | `h1`, only on login/empty |
| Section | 16 / 650 | `h2`, letter-spacing -0.02em |
| Card title | 14.5 / 620 | session title, 2-line clamp |
| Body | 14 / 400 | line-height 1.62 for messages |
| Meta | 11.5 / 400 | timestamps, project, model |
| Label | 10.5 / 600 | uppercase, letter-spacing .02em |
| Code | 12 / 400 mono | `pre` max-height 340 px |

No external fonts. Chinese and English share the same stack; avoid faux-bold.

## 4. Spacing & radius

- Base grid **4 px**; common gaps 6 / 8 / 10 / 12 / 14 / 16.
- Page padding 16 px mobile, 22 px ≥720 px.
- Radius: cards 16, inputs/buttons 12, bubbles 15, sheets 22, pills 999.
- Touch targets ≥44×44 px; icon buttons are 40 px with 12 px radius.
- Content bottom padding 104 px + safe area; session view 150 px for the composer.

## 5. Layout

- Max width 880 px, centered; phone-first single column.
- Sticky top bar: 58 px + `env(safe-area-inset-top)`, backdrop blur.
- Bottom nav: 3 tabs (会话 / 队列 / 设置), fixed, `env(safe-area-inset-bottom)`.
- Session view hides the bottom nav and uses a fixed composer.
- Sheets are bottom sheets on mobile, same max width on desktop; max-height 92 dvh.
- Messages: user right-aligned (92% max), assistant full width with a 5 px corner cut.
- Queue: segmented tabs, count in each label, cards with countdown.

## 6. Components & states

| Component | Default | Hover / focus | Active | Disabled |
|---|---|---|---|---|
| Primary button | accent gradient, white | brightness 1.08 | scale .98 | opacity .5 |
| Ghost button | transparent, muted | `--bg-elev-2` | scale .98 | opacity .5 |
| Danger | red soft bg | brightness | scale .98 | opacity .5 |
| Card link | 1 px border | border-strong + elev-2 | scale .995 | — |
| Input | `--bg-input`, 1 px border | — | accent border + 3 px soft ring | — |
| Chip | border, muted | — | accent soft bg / accent text | — |
| Tab | faint | — | accent icon + label | — |

Required states for every async view: **loading** (meter/skeleton), **empty** (icon + one sentence + action), **error** (toast + retry), **offline** (red dot + label).

## 7. Copy

- Chinese UI, English brand/product names.
- Buttons are verbs: `安排发送`, `立即发送`, `重发`, `取消这条`.
- Time is explicit: `今晚 23:30`, `明早 08:00`, `10/27 周二 12:35`.
- Never promise savings: `谷时 · 半额消耗` (not `省一半`).
- Failure messages say what happened and what the system did: `已错过 120 分钟宽限，可手动重发`.
- Permission default copy: `等待我手动处理`; dangerous option is labelled `全部自动放行（危险）`.

## 8. Accessibility

- Focus-visible: 2 px accent ring, never remove outline without replacement.
- All icon-only buttons have `aria-label`.
- Toasts use `role="status"` + `aria-live="polite"`.
- Color contrast ≥4.5:1 for body, ≥3:1 for large text and UI borders.
- `prefers-reduced-motion` collapses animation to 0.001 ms.
- Safe areas and `100dvh`; no hover-only actions.
- Forms use real `<label for>`; datetime input remains native for OS pickers.

## 9. PWA

- Manifest `start_url: "/#/"`, `scope: "/"`, standalone, portrait-primary.
- Icons: 192/512 any + 512 maskable, 180 apple-touch.
- Service worker: shell cache `ocsm-v1`, network-first navigation, never cache `/api/`.
- Theme color matches `--bg` for dark/light.
- Install prompt is offered in Settings only; never modal on first load.

## 10. Do-not list for future contributors

- Do not add a CSS framework or icon package; inline SVG + custom properties only.
- Do not clone OpenCode's full transcript renderer; deep-link to the native UI.
- Do not introduce a second accent color or gradient background.
- Do not auto-approve permissions without an explicit per-schedule opt-in.
- Do not store tokens/passwords in localStorage.
