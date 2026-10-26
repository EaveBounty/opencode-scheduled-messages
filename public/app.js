const app = document.getElementById("app");
const sheetHost = document.getElementById("sheet-host");
const toastEl = document.getElementById("toast");

const state = {
  authed: false,
  view: "sessions",
  sessionID: null,
  session: null,
  messages: [],
  deepLink: null,
  sessions: [],
  projects: [],
  active: {},
  schedules: [],
  permissions: [],
  stats: {},
  defaults: {},
  ui: {},
  server: {},
  version: "",
  filters: { search: "", project: "all", includeChildren: false },
  queueTab: "active",
  sheet: null,
  loading: false,
  busy: false,
  composerText: "",
  composerBusy: false,
  eventSource: null,
  upstreamConnected: false,
  lastSync: 0,
  canInstall: false,
  models: null,
  agents: null,
  toastTimer: null,
  countdownTimer: null,
  permissionTimer: null,
  focusReturn: null,
  lastHello: false,
};

let deferredPrompt = null;
let sessionRefreshTimer = null;
let hashBound = false;

// ---------------------------------------------------------------- utilities

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function icon(name, size = 20) {
  const paths = {
    sessions:
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.4 9.4 0 0 1-3.8-.8L3 21l1.9-4.6A8.3 8.3 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>',
    queue:
      '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
    play: '<path d="m7 4 13 8-13 8Z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    install: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    project: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function toast(message, type = "") {
  clearTimeout(state.toastTimer);
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  requestAnimationFrame(() => toastEl.classList.add("show"));
  state.toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 401) {
    state.authed = false;
    if (!path.includes("/api/auth/login")) {
      closeSheet();
      renderLogin("登录已过期，请重新输入访问令牌");
    }
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || `${response.status} ${response.statusText}`);
  }
  return payload;
}

const unwrap = (value) => (value && typeof value === "object" && "data" in value ? value.data : value);

function relativeTime(ms) {
  if (!ms) return "";
  const diff = Number(ms) - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return "刚刚";
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return new Date(ms).toLocaleDateString("zh-CN");
}

function formatDue(ms, timezone) {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone || undefined,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function formatLocalInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDue() {
  const now = new Date();
  const due = new Date(now);
  due.setHours(23, 30, 0, 0);
  if (due.getTime() <= now.getTime() + 60_000) due.setDate(due.getDate() + 1);
  return due;
}

function projectName(directory) {
  if (!directory) return "未指定项目";
  const parts = String(directory).split("/").filter(Boolean);
  return parts.at(-1) || directory;
}

function isUsefulProject(directory) {
  if (!directory) return false;
  if (directory === "/tmp" || directory === "/tmp/opencode") return false;
  if (/\/session-[0-9a-f-]{16,}$/i.test(directory)) return false;
  return true;
}

function modelLabel(model) {
  if (!model) return "默认模型";
  return `${model.id || model.modelID || "?"}${model.variant ? `#${model.variant}` : ""}`;
}

function isRunning(id) {
  return Boolean(state.active?.[id]);
}

function stateBadge(schedule) {
  const labels = {
    pending: ["待发", "accent"],
    waiting: ["等空闲", "amber"],
    sending: ["发送中", "accent"],
    accepted: ["已发送", "green"],
    done: ["已完成", "green"],
    failed: ["失败", "red"],
    missed: ["已错过", "red"],
    cancelled: ["已取消", ""],
  };
  const [label, tone] = labels[schedule.state] || [schedule.state, ""];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
}

function renderRich(text) {
  const blocks = String(text ?? "").split("```");
  return blocks
    .map((block, index) => {
      if (index % 2 === 1) {
        const newline = block.indexOf("\n");
        const code = newline === -1 ? block : block.slice(newline + 1);
        return `<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`;
      }
      let html = esc(block)
        .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
      html = html.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
        const href = url.replaceAll("&amp;", "&");
        return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
      return html;
    })
    .join("");
}

// ------------------------------------------------------------------- boot

async function init() {
  renderBoot();
  setupViewport();
  registerServiceWorker();
  try {
    const status = await api("/api/auth/status");
    state.authed = Boolean(status.authenticated);
  } catch {
    state.authed = false;
  }
  if (!state.authed) {
    renderLogin();
    return;
  }
  await loadAll();
  connectEvents();
  if (!hashBound) {
    window.addEventListener("hashchange", route);
    hashBound = true;
  }
  route();
}

function renderBoot() {
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <img class="login-logo" src="/icons/icon-192.png" alt="" />
        <h1>OpenCode Scheduled Messages</h1>
        <p>正在连接本机 OpenCode…</p>
        <div class="meter"><span style="width:42%"></span></div>
      </div>
    </div>`;
}

async function loadAll() {
  state.loading = true;
  try {
    const [meta, sessions, projects, active, schedules] = await Promise.all([
      api("/api/state"),
      api("/api/sessions?limit=50"),
      api("/api/projects"),
      api("/api/active"),
      api("/api/schedules?limit=200"),
    ]);
    state.server = meta.server || {};
    state.version = meta.version || "";
    state.defaults = meta.defaults || {};
    state.ui = meta.ui || {};
    state.stats = meta.stats || {};
    state.upstreamConnected = Boolean(meta.server?.connected);
    state.sessions = unwrap(sessions) || [];
    state.projects = unwrap(projects) || [];
    state.active = unwrap(active) || {};
    state.schedules = unwrap(schedules) || [];
    state.lastSync = Date.now();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.loading = false;
  }
}

function route() {
  if (!state.authed) return;
  clearInterval(state.countdownTimer);
  clearInterval(state.permissionTimer);
  state.permissionTimer = null;
  state.permissions = [];
  if (state.sheet) closeSheet();
  const hash = location.hash || "#/";
  const sessionMatch = hash.match(/^#\/s\/([^/]+)/);
  if (sessionMatch) {
    state.view = "session";
    openSession(decodeURIComponent(sessionMatch[1]));
    return;
  }
  if (hash.startsWith("#/q")) state.view = "queue";
  else if (hash.startsWith("#/settings")) state.view = "settings";
  else state.view = "sessions";
  state.sessionID = null;
  state.session = null;
  state.messages = [];
  state.sheet = null;
  render();
}

async function openSession(id) {
  state.sessionID = id;
  state.loading = true;
  render();
  try {
    const [session, messages, link] = await Promise.all([
      api(`/api/sessions/${encodeURIComponent(id)}`),
      api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=30&order=desc`),
      api(`/api/sessions/${encodeURIComponent(id)}/deep-link`).catch(() => null),
    ]);
    if (state.sessionID !== id) return;
    state.session = unwrap(session);
    state.messages = (messages?.data || []).slice().reverse();
    state.deepLink = link?.url || null;
    startPermissionPoll(id, state.session?.location?.directory);
  } catch (error) {
    if (state.sessionID !== id) return;
    toast(error.message, "error");
  } finally {
    if (state.sessionID !== id) return;
    state.loading = false;
    render();
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    });
  }
}

// ----------------------------------------------------------------- render

function render() {
  if (!state.authed) {
    renderLogin();
    return;
  }
  if (state.view === "session") renderSession();
  else if (state.view === "queue") renderQueue();
  else if (state.view === "settings") renderSettings();
  else renderSessions();
  renderSheet();
}

function topbar({ title, sub, back = false, actions = "" }) {
  return `
    <header class="topbar">
      <div class="topbar-inner">
        ${
          back
            ? `<button class="icon-btn" data-action="back" aria-label="返回">${icon("back")}</button>`
            : `<img class="brand-icon" src="/icons/icon-192.png" alt="" width="30" height="30" style="border-radius:9px" />`
        }
        <div class="brand">
          <div class="brand-copy">
            <div class="brand-title">${esc(title)}</div>
            <div class="brand-sub">${sub}</div>
          </div>
        </div>
        ${actions}
      </div>
    </header>`;
}

function connectionBadge() {
  return state.upstreamConnected
    ? `<span class="badge green"><span class="dot running" style="width:5px;height:5px"></span>在线</span>`
    : `<span class="badge red"><span class="dot offline" style="width:5px;height:5px"></span>离线</span>`;
}

function nav(active) {
  const pending = state.schedules.filter((item) => ["pending", "waiting"].includes(item.state)).length;
  return `
    <nav class="bottom-nav" aria-label="主导航">
      <button class="tab ${active === "sessions" ? "active" : ""}" data-action="nav" data-view="sessions">
        ${icon("sessions")}<span>会话</span>
      </button>
      <button class="tab ${active === "queue" ? "active" : ""}" data-action="nav" data-view="queue">
        ${icon("queue")}<span>队列</span>${pending ? `<span class="badge-count">${pending > 9 ? "9+" : pending}</span>` : ""}
      </button>
      <button class="tab ${active === "settings" ? "active" : ""}" data-action="nav" data-view="settings">
        ${icon("settings")}<span>设置</span>
      </button>
    </nav>`;
}

function renderSessions() {
  const projects = [...new Set(state.sessions.map((session) => session.location?.directory).filter(isUsefulProject))];

  app.innerHTML = `
    ${topbar({
      title: "OpenCode 定时消息",
      sub: `${state.sessions.length} 个会话 · ${state.upstreamConnected ? "OpenCode 在线" : "OpenCode 离线"}`,
      actions: `
        <button class="icon-btn" data-action="refresh" aria-label="刷新">${icon("refresh")}</button>
        <button class="icon-btn" data-action="new-session" aria-label="新建会话并定时">${icon("plus")}</button>
      `,
    })}
    <main class="content">
      <div class="stack">
        <div class="search">
          ${icon("search")}
          <input id="search" class="input" type="search" placeholder="搜索标题或项目…" value="${esc(state.filters.search)}" autocomplete="off" />
        </div>
        <div class="row wrap" id="project-chips">
          <button class="chip ${state.filters.project === "all" ? "active" : ""}" data-action="filter-project" data-project="all">全部</button>
          ${projects
            .slice(0, 8)
            .map(
              (project) =>
                `<button class="chip ${state.filters.project === project ? "active" : ""}" data-action="filter-project" data-project="${esc(project)}">${esc(projectName(project))}</button>`,
            )
            .join("")}
        </div>
        <div class="row">
          ${connectionBadge()}
          <span class="small faint">${state.schedules.filter((s) => ["pending", "waiting"].includes(s.state)).length} 条待发</span>
          <span class="spacer"></span>
          <label class="small faint row" style="gap:6px">
            <input id="include-children" type="checkbox" ${state.filters.includeChildren ? "checked" : ""} />
            子会话
          </label>
        </div>
        <section id="session-list"></section>
      </div>
    </main>
    ${nav("sessions")}`;
  updateSessionList();
}

function updateSessionList() {
  const container = document.getElementById("session-list");
  if (!container) return;
  const needle = state.filters.search.trim().toLowerCase();
  const filtered = state.sessions.filter((session) => {
    if (needle) {
      const haystack = `${session.title || ""} ${session.location?.directory || ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (state.filters.project !== "all" && session.location?.directory !== state.filters.project) return false;
    return true;
  });

  if (state.loading) {
    container.innerHTML = `<div class="empty"><div class="meter"><span style="width:60%"></span></div><p style="margin-top:12px">正在读取会话…</p></div>`;
    return;
  }
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon("sessions", 24)}</div>
        <h3>没有匹配的会话</h3>
        <p>在 OpenCode 里创建一个会话，或换一个搜索词。</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="section-head">
      <h2>最近会话</h2>
      <span class="count">${filtered.length}</span>
    </div>
    <div class="stack">
      ${filtered
        .map((session) => {
          const running = isRunning(session.id);
          const model = session.model ? `${session.model.id}${session.model.variant ? `#${session.model.variant}` : ""}` : "";
          return `
            <article class="card link session-card" data-action="open-session" data-id="${esc(session.id)}" role="button" tabindex="0">
              <div>
                <div class="session-title">${esc(session.title || "未命名会话")}</div>
                <div class="session-meta">
                  <span class="dot ${running ? "running" : ""}"></span>
                  <span>${running ? "运行中" : "空闲"}</span>
                  <span class="faint">·</span>
                  <span>${esc(projectName(session.location?.directory))}</span>
                  <span class="faint">·</span>
                  <span>${esc(relativeTime(session.time?.updated || session.time?.created))}</span>
                  ${model ? `<span class="badge">${esc(model)}</span>` : ""}
                  ${session.outcome === "failed" ? `<span class="badge red">失败</span>` : ""}
                </div>
              </div>
              <div class="session-actions">
                <button class="icon-btn" data-action="schedule-session" data-id="${esc(session.id)}" aria-label="为这个会话定时">${icon("clock", 17)}</button>
              </div>
            </article>`;
        })
        .join("")}
    </div>`;
}

function renderSession() {
  const session = state.session;
  const title = session?.title || "会话";
  const running = isRunning(state.sessionID);
  const model = session?.model ? modelLabel(session.model) : "";
  const messages = state.messages;

  app.innerHTML = `
    ${topbar({
      title,
      sub: `${esc(projectName(session?.location?.directory))} · ${esc(model || "默认模型")} · ${running ? "运行中" : "空闲"}`,
      back: true,
      actions: `
        ${state.deepLink ? `<a class="icon-btn" href="${esc(state.deepLink)}" target="_blank" rel="noopener noreferrer" aria-label="打开完整会话">${icon("link")}</a>` : ""}
        <button class="icon-btn" data-action="refresh-session" aria-label="刷新">${icon("refresh")}</button>
      `,
    })}
    <main class="content no-nav" id="messages">
      ${
        state.permissions.length
          ? `<div class="notice danger" style="margin-bottom:12px">
              <strong>${state.permissions.length} 个权限请求等待处理</strong>
              <div class="small" style="margin-top:4px;color:var(--muted)">
                ${esc(state.permissions.map((request) => request.action).join(" / "))} — 定时任务会停在这里，不会自动批准。
              </div>
              ${state.deepLink ? `<a class="small" href="${esc(state.deepLink)}" target="_blank" rel="noopener noreferrer">在 OpenCode 原生界面处理 →</a>` : ""}
            </div>`
          : ""
      }
      ${
        state.loading
          ? `<div class="empty"><div class="meter"><span style="width:60%"></span></div><p style="margin-top:12px">读取消息…</p></div>`
          : messages.length === 0
            ? `<div class="empty"><div class="empty-icon">${icon("sessions", 24)}</div><h3>还没有消息</h3><p>在下面写一句，或安排到今晚低峰时段。</p></div>`
            : `<div class="msg-list">${messages.map(renderMessage).join("")}</div>`
      }
      ${running ? `<div class="idle-divider">正在运行…</div>` : ""}
    </main>
    <div class="composer">
      <div class="composer-tools">
        <button class="chip" data-action="open-sheet" data-target="session">${icon("clock", 13)} 定时发送</button>
        <button class="chip" data-action="send-now" ${state.composerBusy ? "disabled" : ""}>${icon("send", 13)} 立即发送</button>
        <span class="spacer"></span>
        <span class="small faint" style="align-self:center">⌘/Ctrl + Enter</span>
      </div>
      <div class="composer-inner">
        <textarea id="composer-text" rows="1" placeholder="写一句… 到点自动发到这个会话">${esc(state.composerText)}</textarea>
        <button class="send" data-action="send-now" ${state.composerBusy ? "disabled" : ""} aria-label="立即发送">${icon("send")}</button>
      </div>
    </div>`;
  autoResize();
}

function renderMessage(message) {
  if (message.type === "user") {
    return `
      <article class="msg user">
        <div class="msg-label">你</div>
        <div class="msg-bubble"><div class="msg-body">${renderRich(message.text)}</div></div>
        <div class="msg-meta">${esc(relativeTime(message.created))}</div>
      </article>`;
  }
  if (message.type === "idle") {
    return `<div class="idle-divider">${message.outcome === "failed" ? "这一轮失败" : "这一轮结束"} · ${esc(relativeTime(message.created))}</div>`;
  }
  if (message.type !== "assistant") return "";
  const parts = (message.parts || [])
    .map((part) => {
      if (part.kind === "text") return `<div class="msg-body">${renderRich(part.text)}</div>`;
      if (part.kind === "reasoning") {
        return `<details class="reasoning"><summary>思考过程</summary><div>${esc(part.text)}</div></details>`;
      }
      if (part.kind === "tool") {
        return `<details class="tool"><summary><span class="tool-name">${esc(part.name)}</span><span class="badge ${part.status === "completed" ? "green" : part.status === "failed" ? "red" : ""}">${esc(part.status)}</span></summary><pre>${esc(part.output || JSON.stringify(part.input, null, 2) || "")}</pre></details>`;
      }
      return "";
    })
    .join("");
  const tokens = message.tokens
    ? `${message.tokens.input ?? 0} in / ${message.tokens.output ?? 0} out`
    : "";
  return `
    <article class="msg assistant">
      <div class="msg-label">OpenCode${message.agent ? ` · ${esc(message.agent)}` : ""}</div>
      <div class="msg-bubble">${parts || `<div class="msg-body faint">（空消息）</div>`}</div>
      <div class="msg-meta">
        <span>${esc(relativeTime(message.created))}</span>
        ${tokens ? `<span>${esc(tokens)}</span>` : ""}
        ${message.cost ? `<span>$${Number(message.cost).toFixed(4)}</span>` : ""}
      </div>
    </article>`;
}

function renderQueue() {
  const tabs = {
    active: { label: "待发", states: ["pending", "waiting", "sending"] },
    done: { label: "已发", states: ["accepted", "done"] },
    issues: { label: "异常", states: ["failed", "missed"] },
    cancelled: { label: "已取消", states: ["cancelled"] },
  };
  const current = tabs[state.queueTab] || tabs.active;
  const items = state.schedules
    .filter((item) => current.states.includes(item.state))
    .sort((a, b) => {
      if (state.queueTab === "active") return (a.dueAt || 0) - (b.dueAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  app.innerHTML = `
    ${topbar({
      title: "发送队列",
      sub: `${state.stats.pending || 0} 待发 · ${state.stats.accepted || 0} 已发送 · ${state.stats.missed || 0} 错过`,
      actions: `<button class="icon-btn" data-action="refresh" aria-label="刷新">${icon("refresh")}</button>`,
    })}
    <main class="content">
      <div class="segmented" style="margin-bottom:12px">
        ${Object.entries(tabs)
          .map(
            ([key, tab]) =>
              `<button class="${state.queueTab === key ? "active" : ""}" data-action="queue-tab" data-tab="${key}">${tab.label} ${state.schedules.filter((s) => tab.states.includes(s.state)).length}</button>`,
          )
          .join("")}
      </div>
      <div class="stack" id="queue-list">
        ${
          items.length === 0
            ? `<div class="empty"><div class="empty-icon">${icon("queue", 24)}</div><h3>这里是空的</h3><p>去会话里点“定时发送”，安排一句话。</p></div>`
            : items.map(renderScheduleCard).join("")
        }
      </div>
    </main>
    ${nav("queue")}`;
  startCountdowns();
}

function renderScheduleCard(item) {
  const active = ["pending", "waiting", "sending"].includes(item.state);
  const canCancel = ["pending", "waiting"].includes(item.state);
  const issues = ["failed", "missed"].includes(item.state);
  const target =
    item.target.kind === "new"
      ? `新建 · ${projectName(item.target.directory)}`
      : item.target.title || "已有会话";
  const canEdit = ["pending", "waiting"].includes(item.state);
  return `
    <article class="card queue-card" data-id="${esc(item.id)}">
      <div class="queue-top">
        <div class="queue-title">${esc(target)}</div>
        ${stateBadge(item)}
      </div>
      <div class="queue-text">${esc(item.text)}</div>
      <div class="queue-foot">
        <span class="small faint">${esc(formatDue(item.dueAt, item.timezone))}</span>
        ${active ? `<span class="countdown" data-due="${item.dueAt}">${countdownText(item.dueAt)}</span>` : ""}
        ${item.attempt > 1 ? `<span class="badge">第 ${item.attempt} 次</span>` : ""}
        ${item.state === "waiting" ? `<span class="badge amber">等会话空闲</span>` : ""}
        <span class="spacer"></span>
        ${item.resultSessionID ? `<a class="icon-btn" href="#/s/${esc(item.resultSessionID)}" aria-label="打开会话">${icon("link", 16)}</a>` : ""}
        ${canEdit ? `<button class="icon-btn" data-action="edit-schedule" data-id="${esc(item.id)}" aria-label="编辑">${icon("edit", 16)}</button>` : ""}
        ${canCancel ? `<button class="icon-btn danger" data-action="cancel-schedule" data-id="${esc(item.id)}" aria-label="取消">${icon("trash", 16)}</button>` : ""}
        ${issues ? `<button class="btn small primary" data-action="retry-schedule" data-id="${esc(item.id)}">重发</button>` : ""}
      </div>
      ${item.lastError ? `<div class="small" style="color:var(--red)">${esc(item.lastError)}</div>` : ""}
    </article>`;
}

function countdownText(dueAt) {
  if (!dueAt) return "";
  const diff = dueAt - Date.now();
  if (diff <= 0) return "已到点";
  const total = Math.round(diff / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 24) return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

function startCountdowns() {
  clearInterval(state.countdownTimer);
  const update = () => {
    for (const node of document.querySelectorAll("[data-due]")) {
      const due = Number(node.dataset.due);
      node.textContent = countdownText(due);
      node.classList.toggle("soon", due - Date.now() < 10 * 60_000 && due > Date.now());
      node.classList.toggle("late", due <= Date.now());
    }
  };
  update();
  state.countdownTimer = setInterval(update, 1000);
}

function renderSettings() {
  const defaults = state.defaults || {};
  const server = state.server || {};
  app.innerHTML = `
    ${topbar({
      title: "设置",
      sub: `v${esc(state.version || "")} · ${state.upstreamConnected ? "OpenCode 在线" : "OpenCode 离线"}`,
      actions: `<button class="icon-btn" data-action="refresh" aria-label="刷新">${icon("refresh")}</button>`,
    })}
    <main class="content">
      <div class="stack">
        <section class="card">
          <h2 style="margin-bottom:10px">连接</h2>
          <dl class="kv">
            <dt>OpenCode</dt><dd>${esc(server.opencodeBaseUrl || "—")}</dd>
            <dt>原生界面</dt><dd>${esc(server.nativeDeepLinkBase || "—")}</dd>
            <dt>网关地址</dt><dd>${esc(server.publicUrl || location.origin)}</dd>
            <dt>事件流</dt><dd>${state.upstreamConnected ? "connected" : "disconnected"}</dd>
            <dt>上游版本</dt><dd>${esc(server.upstreamVersion || "—")}</dd>
          </dl>
        </section>

        <section class="card">
          <h2 style="margin-bottom:10px">默认策略</h2>
          <form id="settings-form" class="stack">
            <div class="grid-2">
              <div class="field">
                <label for="setting-tz">时区</label>
                <input class="input" id="setting-tz" name="timezone" value="${esc(defaults.timezone || "Asia/Shanghai")}" />
              </div>
              <div class="field">
                <label for="setting-busy">到点时会话正忙</label>
                <select class="select" id="setting-busy" name="busyPolicy">
                  <option value="wait" ${defaults.busyPolicy === "wait" ? "selected" : ""}>等空闲（最多 30 分钟）</option>
                  <option value="steer" ${defaults.busyPolicy === "steer" ? "selected" : ""}>插入当前轮</option>
                  <option value="skip" ${defaults.busyPolicy === "skip" ? "selected" : ""}>跳过</option>
                </select>
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="setting-wait">等空闲上限（分钟）</label>
                <input class="input" id="setting-wait" name="waitMinutes" type="number" min="0" max="1440" value="${Number(defaults.waitMinutes ?? 30)}" />
              </div>
              <div class="field">
                <label for="setting-grace">开机后补发宽限（分钟）</label>
                <input class="input" id="setting-grace" name="graceMinutes" type="number" min="0" max="10080" value="${Number(defaults.graceMinutes ?? 120)}" />
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="setting-perm">权限请求</label>
                <select class="select" id="setting-perm" name="permissionPolicy">
                  <option value="wait" ${defaults.permissionPolicy === "wait" ? "selected" : ""}>等待我手动处理</option>
                  <option value="reject" ${defaults.permissionPolicy === "reject" ? "selected" : ""}>超时自动拒绝</option>
                  <option value="allow-readonly" ${defaults.permissionPolicy === "allow-readonly" ? "selected" : ""}>只读工具自动放行</option>
                  <option value="allow-all" ${defaults.permissionPolicy === "allow-all" ? "selected" : ""}>全部自动放行（危险）</option>
                </select>
              </div>
              <div class="field">
                <label for="setting-perm-timeout">权限超时（分钟）</label>
                <input class="input" id="setting-perm-timeout" name="permissionTimeoutMinutes" type="number" min="1" max="1440" value="${Number(defaults.permissionTimeoutMinutes ?? 10)}" />
              </div>
            </div>
            <div class="field">
              <label for="setting-public">网关对外地址（可选）</label>
              <input class="input" id="setting-public" value="${esc(server.publicUrl || "")}" placeholder="https://host.tailnet.ts.net" />
              <div class="field-hint">用于手机/反代场景；留空则使用当前访问地址。</div>
            </div>
            <div class="field">
              <label for="setting-oc-public">OpenCode 原生界面地址（可选）</label>
              <input class="input" id="setting-oc-public" value="${esc(server.nativeDeepLinkBase || "")}" placeholder="https://host.tailnet.ts.net:8443" />
              <div class="field-hint">“完整会话”按钮会跳到这里；局域网通常是 http://&lt;LAN-IP&gt;:4096。</div>
            </div>
            <button class="btn primary" type="submit">保存默认值</button>
          </form>
        </section>

        <section class="card">
          <h2 style="margin-bottom:8px">安装与访问</h2>
          <p class="small muted" style="margin:0 0 12px">
            手机通过 HTTPS 打开本页后可“添加到主屏幕”。局域网 HTTP 可用，但无法注册 Service Worker。
          </p>
          <div class="row wrap">
            ${state.canInstall ? `<button class="btn primary" data-action="install">${icon("install", 16)} 安装到主屏</button>` : ""}
            <button class="btn" data-action="logout">${icon("logout", 16)} 退出登录</button>
          </div>
        </section>

        <section class="card">
          <h2 style="margin-bottom:8px">说明</h2>
          <p class="small muted" style="margin:0;line-height:1.6">
            定时任务只保存在本机 SQLite。OpenCode 离线时会按宽限时间重试；超过宽限则标记“已错过”，不会静默补发。
            权限请求默认不自动批准，避免无人值守时执行未授权的 shell/edit。
          </p>
        </section>
      </div>
    </main>
    ${nav("settings")}`;
}

// ------------------------------------------------------------------ sheet

function openSheet(config = {}) {
  const textarea = document.getElementById("composer-text");
  if (textarea && config.type !== "edit") state.composerText = textarea.value;
  const defaults = state.defaults || {};
  const known = config.sessionID ? state.sessions.find((session) => session.id === config.sessionID) : null;
  state.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  state.sheet = {
    type: config.type || "session",
    sessionID: config.sessionID || state.sessionID,
    schedule: config.schedule || null,
    targetTitle: config.title || known?.title || state.session?.title || null,
    targetDirectory: known?.location?.directory || state.session?.location?.directory || null,
    text: config.text ?? state.composerText ?? "",
    due: config.due || formatLocalInput(defaultDue()),
    busyPolicy: config.busyPolicy || defaults.busyPolicy || "wait",
    waitMinutes: config.waitMinutes ?? defaults.waitMinutes ?? 30,
    graceMinutes: config.graceMinutes ?? defaults.graceMinutes ?? 120,
    permissionPolicy: config.permissionPolicy || defaults.permissionPolicy || "wait",
    permissionTimeoutMinutes: config.permissionTimeoutMinutes ?? defaults.permissionTimeoutMinutes ?? 10,
    directory: config.directory || state.projects[0]?.canonical || "",
    title: config.title || "",
    agent: config.agent || "",
    model: config.model || "",
  };
  if (state.sheet.type === "new" && !state.models) loadModelsAndAgents();
  render();
  app.inert = true;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    const field = document.getElementById("sheet-text");
    field?.focus();
    field?.setSelectionRange?.(field.value.length, field.value.length);
  });
}

function syncSheetFromDOM() {
  if (!state.sheet) return;
  const value = (id) => document.getElementById(id)?.value;
  if (document.getElementById("sheet-text")) state.sheet.text = value("sheet-text");
  if (document.getElementById("sheet-due")) state.sheet.due = value("sheet-due");
  if (document.getElementById("sheet-busy")) state.sheet.busyPolicy = value("sheet-busy");
  if (document.getElementById("sheet-wait")) state.sheet.waitMinutes = Number(value("sheet-wait"));
  if (document.getElementById("sheet-grace")) state.sheet.graceMinutes = Number(value("sheet-grace"));
  if (document.getElementById("sheet-perm")) state.sheet.permissionPolicy = value("sheet-perm");
  if (document.getElementById("sheet-perm-timeout")) state.sheet.permissionTimeoutMinutes = Number(value("sheet-perm-timeout"));
  if (document.getElementById("sheet-directory")) state.sheet.directory = value("sheet-directory");
  if (document.getElementById("sheet-new-title")) state.sheet.title = value("sheet-new-title");
  if (document.getElementById("sheet-agent")) state.sheet.agent = value("sheet-agent");
  if (document.getElementById("sheet-model")) state.sheet.model = value("sheet-model");
}

async function loadModelsAndAgents() {
  try {
    const [models, agents] = await Promise.all([api("/api/models"), api("/api/agents")]);
    state.models = unwrap(models) || [];
    state.agents = unwrap(agents) || [];
    syncSheetFromDOM();
    renderSheet(true);
  } catch {
    // Optional; the sheet still works without them.
  }
}

function renderSheet(force = false) {
  if (!state.sheet) return;
  const sheet = state.sheet;
  const existing = document.getElementById("sheet-root");
  if (existing) {
    if (!force) return;
    existing.remove();
  }

  if (sheet.type === "new" && state.models && !sheet.model) {
    const available = state.models.filter((model) => model.enabled && model.status === "active");
    const preferred = available.find((model) => /deepseek/i.test(model.id || model.modelID || ""));
    const first = preferred || available[0];
    if (first) sheet.model = `${first.providerID}/${first.id}`;
  }

  const isEdit = sheet.type === "edit";
  const isNew = sheet.type === "new";
  const projectOptions = state.projects
    .map(
      (project) =>
        `<option value="${esc(project.canonical)}" ${sheet.directory === project.canonical ? "selected" : ""}>${esc(projectName(project.canonical))} — ${esc(project.canonical)}</option>`,
    )
    .join("");
  const modelOptions = (state.models || [])
    .filter((model) => model.enabled && model.status === "active")
    .map((model) => {
      const value = `${model.providerID}/${model.id}`;
      return `<option value="${esc(value)}" ${sheet.model === value ? "selected" : ""}>${esc(model.id)}${model.variants?.length ? ` (+${model.variants.length} variants)` : ""}</option>`;
    })
    .join("");
  const agentOptions = (state.agents || [])
    .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    .map(
      (agent) =>
        `<option value="${esc(agent.id)}" ${sheet.agent === agent.id ? "selected" : ""}>${esc(agent.name || agent.id)}</option>`,
    )
    .join("");

  const root = document.createElement("div");
  root.id = "sheet-root";
  root.className = "sheet-backdrop";
  root.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2 id="sheet-title">${isEdit ? "编辑定时" : isNew ? "新建会话并定时" : "定时发送"}</h2>
        <button class="icon-btn" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
      </div>

      ${
        isNew
          ? `<div class="field">
              <label for="sheet-directory">项目目录</label>
              <select class="select" id="sheet-directory">${projectOptions || `<option value="">（没有可用项目）</option>`}</select>
            </div>
            <div class="field">
              <label for="sheet-new-title">新会话标题（可选）</label>
              <input class="input" id="sheet-new-title" value="${esc(sheet.title)}" placeholder="例如：夜里的想法" />
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="sheet-model">模型</label>
                <select class="select" id="sheet-model">${modelOptions || `<option value="">默认</option>`}</select>
              </div>
              <div class="field">
                <label for="sheet-agent">Agent</label>
                <select class="select" id="sheet-agent"><option value="">默认</option>${agentOptions}</select>
              </div>
            </div>`
          : `<div class="notice" style="margin-bottom:12px">
              ${esc(sheet.targetTitle || state.session?.title || state.schedules.find((s) => s.id === sheet.schedule?.id)?.target?.title || "目标会话")}
              <div class="small faint" style="margin-top:3px">${esc(projectName(sheet.targetDirectory || state.session?.location?.directory || sheet.schedule?.target?.directory))}</div>
            </div>`
      }

      <div class="field">
        <label for="sheet-text">消息</label>
        <textarea class="textarea" id="sheet-text" placeholder="一句话就好">${esc(sheet.text)}</textarea>
      </div>

      <div class="field">
        <label for="sheet-due">发送时间</label>
        <input class="input" id="sheet-due" type="datetime-local" value="${esc(sheet.due)}" />
        <div class="row wrap" style="margin-top:8px">
          <span id="peak-hint" class="badge">—</span>
          <span class="field-hint" style="margin:0">按 DeepSeek 官方工作日峰谷估算（不含法定节假日）</span>
        </div>
        <div class="quick-times" style="margin-top:8px">
          <button class="chip" data-action="quick-time" data-when="tonight">今晚 23:30</button>
          <button class="chip" data-action="quick-time" data-when="morning">明早 08:00</button>
          <button class="chip" data-action="quick-time" data-when="hour">1 小时后</button>
          <button class="chip" data-action="quick-time" data-when="now">现在</button>
        </div>
        <div class="field-hint">按你手机当前时区（${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}）计算；服务端存绝对时间。</div>
      </div>

      <details class="advanced" style="margin-top:14px">
        <summary>高级：忙闲与权限</summary>
        <div class="grid-2" style="margin-top:10px">
          <div class="field">
            <label for="sheet-busy">到点时会话正忙</label>
            <select class="select" id="sheet-busy">
              <option value="wait" ${sheet.busyPolicy === "wait" ? "selected" : ""}>等空闲（最多 ${Number(sheet.waitMinutes)} 分钟）</option>
              <option value="steer" ${sheet.busyPolicy === "steer" ? "selected" : ""}>插入当前轮</option>
              <option value="skip" ${sheet.busyPolicy === "skip" ? "selected" : ""}>跳过</option>
            </select>
          </div>
          <div class="field">
            <label for="sheet-grace">错过后的补发宽限（分钟）</label>
            <input class="input" id="sheet-grace" type="number" min="0" max="10080" value="${Number(sheet.graceMinutes)}" />
          </div>
        </div>
        <div class="grid-2" style="margin-top:10px">
          <div class="field">
            <label for="sheet-wait">等空闲上限（分钟）</label>
            <input class="input" id="sheet-wait" type="number" min="0" max="1440" value="${Number(sheet.waitMinutes)}" />
          </div>
          <div class="field">
            <label for="sheet-perm">权限请求</label>
            <select class="select" id="sheet-perm">
              <option value="wait" ${sheet.permissionPolicy === "wait" ? "selected" : ""}>等我手动处理</option>
              <option value="reject" ${sheet.permissionPolicy === "reject" ? "selected" : ""}>超时自动拒绝</option>
              <option value="allow-readonly" ${sheet.permissionPolicy === "allow-readonly" ? "selected" : ""}>只读工具自动放行</option>
              <option value="allow-all" ${sheet.permissionPolicy === "allow-all" ? "selected" : ""}>全部自动放行（危险）</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin-top:10px">
          <label for="sheet-perm-timeout">权限超时（分钟）</label>
          <input class="input" id="sheet-perm-timeout" type="number" min="1" max="1440" value="${Number(sheet.permissionTimeoutMinutes)}" />
        </div>
        <div class="field-hint" style="margin-top:8px">
          默认“等我手动处理”：权限请求会挂起这一轮，消息不会执行未授权工具。要完全无人值守，需提前选好策略。
        </div>
      </details>

      ${
        isEdit
          ? `<div class="row" style="margin-top:16px">
              <button class="btn danger" data-action="delete-schedule" data-id="${esc(sheet.schedule?.id)}">取消这条</button>
              <span class="spacer"></span>
              <button class="btn primary" data-action="submit-sheet">保存</button>
            </div>`
          : `<button class="btn primary block" style="margin-top:16px" data-action="submit-sheet">${isNew ? "新建并定时" : "安排发送"}</button>`
      }
      <div class="field-hint" style="text-align:center;margin-top:10px">
        到点后若 OpenCode 离线，会在宽限时间内重试；超过宽限标记“已错过”。
      </div>
    </div>`;
  sheetHost.appendChild(root);
  updatePeakHint();
}

/** DeepSeek official peak windows: Mon-Fri 01:00-04:00 and 06:00-10:00 UTC. */
function updatePeakHint() {
  const hint = document.getElementById("peak-hint");
  const input = document.getElementById("sheet-due");
  if (!hint || !input) return;
  const date = new Date(input.value);
  if (Number.isNaN(date.getTime())) {
    hint.className = "badge";
    hint.textContent = "—";
    return;
  }
  const day = date.getUTCDay();
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const peak = day !== 0 && day !== 6 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
  hint.className = `badge ${peak ? "amber" : "green"}`;
  hint.textContent = peak ? "DeepSeek 峰时 · 全额额度" : "DeepSeek 谷时 · 半额消耗";
}

function closeSheet() {
  if (!state.sheet) return;
  state.sheet = null;
  const root = document.getElementById("sheet-root");
  if (root) root.remove();
  app.inert = false;
  app.removeAttribute("inert");
  document.body.style.overflow = "";
  const target = state.focusReturn;
  state.focusReturn = null;
  if (target && document.contains(target)) {
    target.focus?.();
  } else {
    const fallback =
      document.getElementById("composer-text") ||
      document.querySelector('[data-action="open-sheet"]') ||
      document.getElementById("search");
    fallback?.focus?.();
  }
}

async function submitSheet() {
  const sheet = state.sheet;
  if (!sheet) return;
  const text = document.getElementById("sheet-text")?.value?.trim() || "";
  const dueLocal = document.getElementById("sheet-due")?.value || "";
  if (!text) return toast("写一句再安排", "error");
  if (!dueLocal) return toast("选一个发送时间", "error");
  const dueAt = new Date(dueLocal).getTime();
  if (!Number.isFinite(dueAt)) return toast("时间格式不对", "error");

  const payload = {
    text,
    dueAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    busyPolicy: document.getElementById("sheet-busy")?.value || "wait",
    waitMinutes: Number(document.getElementById("sheet-wait")?.value ?? 30),
    graceMinutes: Number(document.getElementById("sheet-grace")?.value ?? 120),
    permissionPolicy: document.getElementById("sheet-perm")?.value || "wait",
    permissionTimeoutMinutes: Number(document.getElementById("sheet-perm-timeout")?.value ?? 10),
  };

  if (sheet.type === "edit") {
    await saveEdit(sheet.schedule.id, payload);
    return;
  }

  if (sheet.type === "new") {
    payload.target = {
      kind: "new",
      directory: document.getElementById("sheet-directory")?.value || "",
      title: document.getElementById("sheet-new-title")?.value?.trim() || null,
    };
    const modelValue = document.getElementById("sheet-model")?.value || "";
    const [providerID, ...rest] = modelValue.split("/");
    if (providerID && rest.length) {
      payload.model = { providerID, id: rest.join("/") };
    }
    const agent = document.getElementById("sheet-agent")?.value;
    if (agent) payload.agent = agent;
  } else {
    payload.target = { kind: "session", sessionID: sheet.sessionID };
  }

  const button = document.querySelector('[data-action="submit-sheet"]');
  if (button) button.disabled = true;
  try {
    await api("/api/schedules", { method: "POST", body: payload });
    state.composerText = "";
    closeSheet();
    toast("已安排，到点自动发送");
    await refreshSchedules();
    if (sheet.type === "new") location.hash = "#/q";
    else render();
  } catch (error) {
    toast(error.message, "error");
    if (button) button.disabled = false;
  }
}

async function saveEdit(id, payload) {
  const button = document.querySelector('[data-action="submit-sheet"]');
  if (button) button.disabled = true;
  try {
    await api(`/api/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
    closeSheet();
    toast("已更新");
    await refreshSchedules();
    render();
  } catch (error) {
    toast(error.message, "error");
    if (button) button.disabled = false;
  }
}

async function refreshSchedules() {
  try {
    const data = await api("/api/schedules?limit=200");
    state.schedules = data.data || [];
    state.stats = data.stats || state.stats;
  } catch {
    // Keep the old list.
  }
}

// ---------------------------------------------------------------- actions

async function sendNow() {
  const id = state.sessionID;
  const text = (document.getElementById("composer-text")?.value || state.composerText || "").trim();
  if (!id || !text || state.composerBusy) return;
  state.composerBusy = true;
  state.composerText = text;
  renderSession();
  try {
    await api(`/api/sessions/${encodeURIComponent(id)}/send`, {
      method: "POST",
      body: { text },
    });
    if (state.sessionID === id) {
      state.composerText = "";
      toast("已发送");
      await refreshSession();
    }
  } catch (error) {
    if (state.sessionID === id) toast(error.message, "error");
  } finally {
    state.composerBusy = false;
    if (state.sessionID === id) renderSession();
  }
}

async function refreshSession() {
  const id = state.sessionID;
  if (!id) return;
  try {
    const [session, messages, link] = await Promise.all([
      api(`/api/sessions/${encodeURIComponent(id)}`),
      api(`/api/sessions/${encodeURIComponent(id)}/messages?limit=30&order=desc`),
      api(`/api/sessions/${encodeURIComponent(id)}/deep-link`).catch(() => null),
    ]);
    if (state.sessionID !== id) return;
    state.session = unwrap(session);
    state.messages = (messages?.data || []).slice().reverse();
    state.deepLink = link?.url || state.deepLink;
    renderSession();
    loadPermissions(id, state.session?.location?.directory);
  } catch (error) {
    if (state.sessionID === id) toast(error.message, "error");
  }
}

function startPermissionPoll(id, directory) {
  clearInterval(state.permissionTimer);
  const load = () => loadPermissions(id, directory);
  load();
  state.permissionTimer = setInterval(load, 10_000);
}

async function loadPermissions(id, directory) {
  try {
    const data = await api(
      `/api/permissions${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
    );
    const list = Array.isArray(data) ? data : data?.data || [];
    if (state.sessionID !== id) return;
    const next = list.filter((request) => request.sessionID === id);
    const changed =
      next.length !== state.permissions.length ||
      next.some((request, index) => request.id !== state.permissions[index]?.id);
    if (!changed) return;
    state.permissions = next;
    if (state.view === "session") renderSession();
  } catch {
    // Permission visibility is best-effort; the native UI remains authoritative.
  }
}

async function cancelSchedule(id) {
  if (!confirm("取消这条定时消息？")) return;
  try {
    await api(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("已取消");
    await refreshSchedules();
    render();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function retrySchedule(id) {
  try {
    await api(`/api/schedules/${encodeURIComponent(id)}/retry`, { method: "POST" });
    toast("已重新排队");
    await refreshSchedules();
    render();
  } catch (error) {
    toast(error.message, "error");
  }
}

function editSchedule(id) {
  const item = state.schedules.find((schedule) => schedule.id === id);
  if (!item) return;
  openSheet({
    type: "edit",
    schedule: item,
    text: item.text,
    due: formatLocalInput(new Date(item.dueAt)),
    busyPolicy: item.busyPolicy,
    waitMinutes: item.waitMinutes,
    graceMinutes: item.graceMinutes,
    permissionPolicy: item.permissionPolicy,
    permissionTimeoutMinutes: item.permissionTimeoutMinutes,
  });
}

function setQuickTime(when) {
  const input = document.getElementById("sheet-due");
  if (!input) return;
  const now = new Date();
  let due;
  if (when === "tonight") {
    due = new Date(now);
    due.setHours(23, 30, 0, 0);
    if (due <= now) due.setDate(due.getDate() + 1);
  } else if (when === "morning") {
    due = new Date(now);
    due.setDate(due.getDate() + 1);
    due.setHours(8, 0, 0, 0);
  } else if (when === "hour") {
    due = new Date(now.getTime() + 3_600_000);
  } else {
    due = new Date(now.getTime() + 60_000);
  }
  input.value = formatLocalInput(due);
}

async function handleEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.type === "hello") {
    state.stats = event.stats || state.stats;
    state.upstreamConnected = Boolean(event.upstream?.connected);
    if (state.lastHello) {
      refreshSchedules().then(() => {
        if (state.view === "queue") renderQueue();
        if (state.view === "sessions") updateSessionList();
      });
    }
    state.lastHello = true;
    return;
  }
  if (event.type === "upstream.connected") {
    state.upstreamConnected = true;
    updateConnectionBadges();
    return;
  }
  if (event.type === "upstream.disconnected") {
    state.upstreamConnected = false;
    updateConnectionBadges();
    return;
  }
  if (String(event.type || "").startsWith("schedule.")) {
    if (event.schedule) {
      const index = state.schedules.findIndex((item) => item.id === event.schedule.id);
      if (index === -1) state.schedules.unshift(event.schedule);
      else state.schedules[index] = event.schedule;
    }
    if (event.type === "schedule.accepted") {
      toast("定时消息已送达 OpenCode");
      scheduleSessionRefresh();
    }
    if (event.type === "schedule.failed") toast(event.schedule?.lastError || "定时发送失败", "error");
    if (state.view === "queue") renderQueue();
    return;
  }
  if (String(event.type || "").startsWith("session.")) {
    if (event.sessionID) {
      const previous = Boolean(state.active[event.sessionID]);
      if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed") {
        delete state.active[event.sessionID];
      } else if (event.type === "session.execution.started") {
        state.active[event.sessionID] = { type: "running" };
      }
      if (previous !== Boolean(state.active[event.sessionID])) {
        if (state.view === "sessions") updateSessionList();
        if (state.sessionID === event.sessionID) renderSession();
      }
    }
    if (state.sessionID && (!event.sessionID || event.sessionID === state.sessionID)) {
      if (event.type === "session.execution.succeeded" || event.type === "session.idle" || event.type === "session.execution.failed") {
        scheduleSessionRefresh();
      }
    }
  }
}

function scheduleSessionRefresh() {
  clearTimeout(sessionRefreshTimer);
  sessionRefreshTimer = setTimeout(() => {
    if (state.view === "session" && state.sessionID) refreshSession();
  }, 600);
}

function updateConnectionBadges() {
  if (state.view === "sessions") renderSessions();
  if (state.view === "settings") renderSettings();
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  const source = new EventSource("/api/events");
  state.eventSource = source;
  source.onmessage = (message) => {
    try {
      handleEvent(JSON.parse(message.data));
    } catch {
      // ignore malformed event
    }
  };
  source.onerror = () => {
    state.upstreamConnected = false;
    updateConnectionBadges();
  };
}

function autoResize() {
  const textarea = document.getElementById("composer-text");
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(150, textarea.scrollHeight)}px`;
}

// ---------------------------------------------------------------- login

function renderLogin(error = "") {
  if (state.sheet) closeSheet();
  app.innerHTML = `
    <div class="login">
      <div class="login-card">
        <img class="login-logo" src="/icons/icon-192.png" alt="" />
        <h1>OpenCode Scheduled Messages</h1>
        <p>把高峰期的想法排到低峰时段，自动发进指定的 OpenCode 会话。</p>
        <form id="login-form">
          <div class="field">
            <label for="token">访问令牌</label>
            <input class="input" id="token" type="password" autocomplete="current-password" placeholder="ocsched 首次启动时打印的 token" autofocus />
          </div>
          <div class="login-error" id="login-error">${esc(error)}</div>
          <button class="btn primary block" type="submit">进入</button>
        </form>
        <div class="field-hint" style="margin-top:14px">
          令牌只保存在本机配置里；忘记了就在终端运行 <code>ocsched --rotate-token</code>。
        </div>
      </div>
    </div>`;
}

async function login(token) {
  try {
    await api("/api/auth/login", { method: "POST", body: { token } });
    state.authed = true;
    await loadAll();
    connectEvents();
    if (!hashBound) {
      window.addEventListener("hashchange", route);
      hashBound = true;
    }
    route();
  } catch (err) {
    const error = document.getElementById("login-error");
    if (error) error.textContent = err.message === "unauthorized" ? "令牌不正确" : err.message;
  }
}

function setupViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--keyboard-offset", `${Math.round(offset)}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  update();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // LAN HTTP is not a secure context; the app still works.
  });
}

// -------------------------------------------------------------- delegation

app.addEventListener("click", (event) => {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) {
    if (event.target.classList.contains("sheet-backdrop")) closeSheet();
    return;
  }
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  if (action === "nav") {
    location.hash = actionEl.dataset.view === "sessions" ? "#/" : `#/${actionEl.dataset.view}`;
    return;
  }
  if (action === "open-session") {
    location.hash = `#/s/${encodeURIComponent(id)}`;
    return;
  }
  if (action === "schedule-session") {
    event.stopPropagation();
    openSheet({ type: "session", sessionID: id, text: "" });
    return;
  }
  if (action === "new-session") {
    openSheet({ type: "new", text: "" });
    return;
  }
  if (action === "back") {
    history.length > 1 ? history.back() : (location.hash = "#/");
    return;
  }
  if (action === "refresh") {
    loadAll().then(() => render());
    return;
  }
  if (action === "refresh-session") {
    refreshSession();
    return;
  }
  if (action === "filter-project") {
    state.filters.project = actionEl.dataset.project;
    renderSessions();
    return;
  }
  if (action === "queue-tab") {
    state.queueTab = actionEl.dataset.tab;
    renderQueue();
    return;
  }
  if (action === "open-sheet") {
    openSheet({ type: "session", sessionID: state.sessionID });
    return;
  }
  if (action === "close-sheet") {
    closeSheet();
    return;
  }
  if (action === "quick-time") {
    setQuickTime(actionEl.dataset.when);
    return;
  }
  if (action === "submit-sheet") {
    submitSheet();
    return;
  }
  if (action === "send-now") {
    sendNow();
    return;
  }
  if (action === "cancel-schedule") {
    cancelSchedule(id);
    return;
  }
  if (action === "retry-schedule") {
    retrySchedule(id);
    return;
  }
  if (action === "edit-schedule") {
    editSchedule(id);
    return;
  }
  if (action === "delete-schedule") {
    cancelSchedule(id).then(() => closeSheet());
    return;
  }
  if (action === "logout") {
    api("/api/auth/logout", { method: "POST" }).finally(() => {
      closeSheet();
      state.authed = false;
      state.eventSource?.close();
      renderLogin();
    });
    return;
  }
  if (action === "install") {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => {
        deferredPrompt = null;
        state.canInstall = false;
        renderSettings();
      });
    }
    return;
  }
});

app.addEventListener("input", (event) => {
  if (state.sheet && event.target.closest?.("#sheet-root")) {
    if (event.target.id === "sheet-text") state.sheet.text = event.target.value;
    if (event.target.id === "sheet-due") {
      state.sheet.due = event.target.value;
      updatePeakHint();
    }
    if (event.target.id === "sheet-busy") state.sheet.busyPolicy = event.target.value;
    if (event.target.id === "sheet-wait") state.sheet.waitMinutes = Number(event.target.value);
    if (event.target.id === "sheet-grace") state.sheet.graceMinutes = Number(event.target.value);
    if (event.target.id === "sheet-perm") state.sheet.permissionPolicy = event.target.value;
    if (event.target.id === "sheet-perm-timeout") state.sheet.permissionTimeoutMinutes = Number(event.target.value);
    if (event.target.id === "sheet-directory") state.sheet.directory = event.target.value;
    if (event.target.id === "sheet-new-title") state.sheet.title = event.target.value;
    if (event.target.id === "sheet-agent") state.sheet.agent = event.target.value;
    if (event.target.id === "sheet-model") state.sheet.model = event.target.value;
  }
  if (event.target.id === "search") {
    state.filters.search = event.target.value;
    updateSessionList();
  }
  if (event.target.id === "composer-text") {
    state.composerText = event.target.value;
    autoResize();
  }
  if (event.target.id === "sheet-busy") {
    const label = event.target.selectedOptions[0]?.textContent || "";
    if (state.sheet) state.sheet.busyPolicy = event.target.value;
    if (state.sheet && event.target.value === "wait") {
      const waitInput = document.getElementById("sheet-wait");
      if (waitInput) {
        event.target.options[0].textContent = `等空闲（最多 ${Number(waitInput.value)} 分钟）`;
      }
    }
    void label;
  }
});

app.addEventListener("change", (event) => {
  if (event.target.id === "include-children") {
    state.filters.includeChildren = event.target.checked;
    api(`/api/sessions?limit=50${event.target.checked ? "&includeChildren=1" : ""}`)
      .then((data) => {
        state.sessions = unwrap(data) || [];
        updateSessionList();
      })
      .catch((error) => toast(error.message, "error"));
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "login-form") {
    const token = document.getElementById("token")?.value?.trim();
    if (token) login(token);
    return;
  }
  if (event.target.id === "settings-form") {
    const body = {
      defaults: {
        timezone: document.getElementById("setting-tz")?.value?.trim(),
        busyPolicy: document.getElementById("setting-busy")?.value,
        waitMinutes: Number(document.getElementById("setting-wait")?.value),
        graceMinutes: Number(document.getElementById("setting-grace")?.value),
        permissionPolicy: document.getElementById("setting-perm")?.value,
        permissionTimeoutMinutes: Number(document.getElementById("setting-perm-timeout")?.value),
      },
      publicUrl: document.getElementById("setting-public")?.value?.trim() || null,
      opencodePublicUrl: document.getElementById("setting-oc-public")?.value?.trim() || null,
    };
    api("/api/settings", { method: "PATCH", body })
      .then(() => {
        toast("已保存");
        return loadAll().then(() => render());
      })
      .catch((error) => toast(error.message, "error"));
  }
});

app.addEventListener("keydown", (event) => {
  if (event.target.id === "composer-text" && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    sendNow();
  }
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.matches?.('[data-action="open-session"]')
  ) {
    event.preventDefault();
    location.hash = `#/s/${encodeURIComponent(event.target.dataset.id)}`;
  }
});

document.addEventListener("keydown", (event) => {
  if (!state.sheet) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeSheet();
    return;
  }
  if (event.key !== "Tab") return;
  const root = document.getElementById("sheet-root");
  if (!root) return;
  const focusables = [
    ...root.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const inside = root.contains(document.activeElement);
  if (event.shiftKey && (!inside || document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  state.canInstall = true;
  if (state.view === "settings") renderSettings();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.authed) {
    if (Date.now() - state.lastSync > 30_000) loadAll().then(() => render());
    if (state.eventSource?.readyState === EventSource.CLOSED) connectEvents();
  }
});

setInterval(() => {
  if (!state.authed || document.visibilityState !== "visible") return;
  if (Date.now() - state.lastSync < 45_000) return;
  api("/api/active")
    .then((data) => {
      state.active = unwrap(data) || {};
      state.lastSync = Date.now();
      if (state.view === "sessions") updateSessionList();
    })
    .catch(() => {});
}, 45_000);

init();
