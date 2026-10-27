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
  allSessions: [],
  projects: [],
  active: {},
  activity: {},
  sessionRoots: {},
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
  eventSource: null,
  upstreamConnected: false,
  lastSync: 0,
  lastActivitySync: 0,
  activityTimer: null,
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
    const code = payload?.error?.code;
    if (code === "invalid_token" || code === "invalid_password") {
      throw new Error(code);
    }
    state.authed = false;
    if (!path.includes("/api/auth/login")) {
      closeSheet();
      renderLogin("登录已过期，请重新输入密码");
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

const PROVIDER_ORDER = ["opencode-go", "opencode", "openrouter", "ollama"];
const PROVIDER_LABELS = {
  "opencode-go": "OpenCode Go",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};
const VARIANT_LABELS = {
  none: "不思考",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  thinking: "思考",
};

function providerLabel(providerID) {
  return PROVIDER_LABELS[providerID] || providerID;
}

function variantLabel(variant) {
  return VARIANT_LABELS[variant] || variant || "默认";
}

function modelDisplayName(model) {
  return model?.name || model?.id || "未命名模型";
}

function normalizeModel(model) {
  if (!model || typeof model !== "object" || !model.providerID || !model.id) return null;
  return {
    providerID: String(model.providerID),
    id: String(model.id),
    variant: model.variant ? String(model.variant) : "",
  };
}

function modelGroups() {
  const groups = new Map();
  for (const model of state.models || []) {
    if (!model.enabled || model.status !== "active") continue;
    if (!groups.has(model.providerID)) groups.set(model.providerID, []);
    groups.get(model.providerID).push(model);
  }
  return [...groups.entries()]
    .map(([providerID, models]) => ({
      providerID,
      models: models.sort((a, b) => modelDisplayName(a).localeCompare(modelDisplayName(b))),
    }))
    .sort((a, b) => {
      const ai = PROVIDER_ORDER.indexOf(a.providerID);
      const bi = PROVIDER_ORDER.indexOf(b.providerID);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.providerID.localeCompare(b.providerID);
    });
}

function selectedSheetModel(sheet) {
  if (!sheet?.model?.providerID || !sheet?.model?.id) return null;
  return (
    (state.models || []).find(
      (model) => model.providerID === sheet.model.providerID && model.id === sheet.model.id,
    ) || null
  );
}

function modelSearchText(model) {
  const variants = (model.variants || []).map((variant) => `${variant.id} ${variantLabel(variant.id)}`);
  return `${modelDisplayName(model)} ${model.id} ${model.providerID} ${providerLabel(model.providerID)} ${variants.join(" ")}`.toLowerCase();
}

function variantChipsHTML(model, selectedVariant) {
  const variants = model.variants || [];
  if (!variants.length) return "";
  return [
    `<button type="button" class="variant-chip ${selectedVariant === "" ? "active" : ""}" data-action="model-variant" data-provider="${esc(model.providerID)}" data-model="${esc(model.id)}" data-variant="">默认</button>`,
    ...variants.map(
      (variant) =>
        `<button type="button" class="variant-chip ${selectedVariant === variant.id ? "active" : ""}" data-action="model-variant" data-provider="${esc(model.providerID)}" data-model="${esc(model.id)}" data-variant="${esc(variant.id)}">${esc(variantLabel(variant.id))}</button>`,
    ),
  ].join("");
}

function modelTreeHTML(selected) {
  return modelGroups()
    .map((group) => {
      const groupSelected = selected?.providerID === group.providerID;
      return `<details class="model-provider" data-provider="${esc(group.providerID)}" data-total="${group.models.length}" data-default-open="${groupSelected ? "1" : "0"}" ${groupSelected ? "open" : ""}>
        <summary>
          <span class="provider-name">${esc(providerLabel(group.providerID))}</span>
          <span class="provider-count">${group.models.length}</span>
          <span class="provider-selected" ${groupSelected ? "" : "hidden"}>${icon("check", 12)}</span>
        </summary>
        <div class="model-list">
          ${group.models
            .map((model) => {
              const isSelected =
                selected?.providerID === model.providerID && selected?.id === model.id;
              const variant = isSelected ? state.sheet?.model?.variant || "" : "";
              const hasVariants = Boolean(model.variants?.length);
              return `<div class="model-option ${isSelected ? "selected" : ""}" data-provider="${esc(model.providerID)}" data-model="${esc(model.id)}" data-search="${esc(modelSearchText(model))}">
                <button type="button" class="model-choice" data-action="model-select" data-provider="${esc(model.providerID)}" data-model="${esc(model.id)}">
                  <span class="model-choice-copy">
                    <span class="model-name">${esc(modelDisplayName(model))}</span>
                    <span class="model-id">${esc(model.id)}</span>
                  </span>
                  <span class="model-choice-meta">
                    ${hasVariants ? `<span class="model-variant-count">${model.variants.length} 档</span>` : ""}
                    <span class="model-check" ${isSelected ? "" : "hidden"}>${icon("check", 14)}</span>
                  </span>
                </button>
                ${isSelected && hasVariants ? `<div class="model-variants">${variantChipsHTML(model, variant)}</div>` : ""}
              </div>`;
            })
            .join("")}
        </div>
      </details>`;
    })
    .join("");
}

function renderModelPicker(sheet) {
  const selected = selectedSheetModel(sheet);
  const variant = sheet.model?.variant || "";
  const variantText = !selected
    ? "选择提供商、模型和思考深度"
    : !selected.variants?.length
      ? `${providerLabel(selected.providerID)} · 无思考档位`
      : `${providerLabel(selected.providerID)} · ${variant ? `思考：${variantLabel(variant)}` : "默认思考深度"}`;
  const ready = Boolean(state.models);
  const total = (state.models || []).filter((model) => model.enabled && model.status === "active").length;
  return `<div class="model-picker" id="model-picker">
    <div class="model-current">
      <div class="model-current-copy">
        <span class="model-current-label">当前选择</span>
        <strong id="model-current-name">${esc(selected ? modelDisplayName(selected) : ready ? "默认模型" : "正在读取模型…")}</strong>
        <span id="model-current-detail">${esc(variantText)}</span>
      </div>
      <button type="button" class="btn small" data-action="toggle-model-picker" aria-expanded="false" ${ready ? "" : "disabled"}>选择模型</button>
    </div>
    <div class="model-picker-body" id="model-picker-body" hidden>
      <div class="model-search">
        ${icon("search", 15)}
        <input class="input" id="model-search" type="search" placeholder="搜索模型、提供商或思考深度…" autocomplete="off" aria-label="搜索模型" />
        <span class="model-match-count" id="model-match-count">${total} 个可用模型</span>
      </div>
      <div class="model-tree" id="model-tree">${ready ? modelTreeHTML(sheet.model) : ""}</div>
    </div>
  </div>`;
}

function filterModelPicker(query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const countEl = document.getElementById("model-match-count");
  let total = 0;
  for (const group of document.querySelectorAll("#model-tree .model-provider")) {
    const options = [...group.querySelectorAll(".model-option")];
    let matches = 0;
    for (const option of options) {
      const match = !needle || (option.dataset.search || "").includes(needle);
      option.hidden = !match;
      if (match) matches += 1;
    }
    group.hidden = matches === 0;
    if (needle) group.open = matches > 0;
    else group.open = group.dataset.defaultOpen === "1";
    const count = group.querySelector(".provider-count");
    if (count) count.textContent = needle ? `${matches}/${group.dataset.total}` : group.dataset.total;
    total += matches;
  }
  if (countEl) countEl.textContent = needle ? `${total} 个匹配` : `${total} 个可用模型`;
}

function updateModelSummary() {
  const sheet = state.sheet;
  if (!sheet) return;
  const selected = selectedSheetModel(sheet);
  const name = document.getElementById("model-current-name");
  const detail = document.getElementById("model-current-detail");
  const variant = sheet.model?.variant || "";
  if (name) name.textContent = selected ? modelDisplayName(selected) : "默认模型";
  if (detail) {
    detail.textContent = !selected
      ? "选择提供商、模型和思考深度"
      : !selected.variants?.length
        ? `${providerLabel(selected.providerID)} · 无思考档位`
        : `${providerLabel(selected.providerID)} · ${variant ? `思考：${variantLabel(variant)}` : "默认思考深度"}`;
  }
}

function ensureVariantHost(option, model, selectedVariant) {
  let host = option.querySelector(".model-variants");
  if (!host) {
    host = document.createElement("div");
    host.className = "model-variants";
    option.appendChild(host);
  }
  host.innerHTML = variantChipsHTML(model, selectedVariant);
}

function updateModelSelectionDOM() {
  const sheet = state.sheet;
  if (!sheet) return;
  const selected = selectedSheetModel(sheet);
  for (const option of document.querySelectorAll("#model-tree .model-option")) {
    const isSelected =
      Boolean(selected) &&
      option.dataset.provider === selected.providerID &&
      option.dataset.model === selected.id;
    option.classList.toggle("selected", isSelected);
    const check = option.querySelector(".model-check");
    if (check) check.hidden = !isSelected;
    const host = option.querySelector(".model-variants");
    if (isSelected && selected.variants?.length) {
      ensureVariantHost(option, selected, sheet.model?.variant || "");
      host?.removeAttribute("hidden");
    } else if (host) {
      host.remove();
    }
  }
  for (const group of document.querySelectorAll("#model-tree .model-provider")) {
    const marker = group.querySelector(".provider-selected");
    const isSelectedProvider = Boolean(selected) && group.dataset.provider === selected.providerID;
    if (marker) marker.hidden = !isSelectedProvider;
    group.dataset.defaultOpen = isSelectedProvider ? "1" : "0";
    if (isSelectedProvider) group.open = true;
  }
  updateModelSummary();
}

function selectSheetModel(providerID, modelID) {
  if (!state.sheet) return;
  const model = (state.models || []).find(
    (item) => item.providerID === providerID && item.id === modelID,
  );
  if (!model) return;
  const current = state.sheet.model;
  state.sheet.model = {
    providerID: model.providerID,
    id: model.id,
    variant:
      current?.providerID === model.providerID && current?.id === model.id
        ? current.variant || ""
        : "",
  };
  updateModelSelectionDOM();
}

function selectSheetVariant(providerID, modelID, variant) {
  if (!state.sheet) return;
  const selected = selectedSheetModel(state.sheet);
  if (!selected || selected.providerID !== providerID || selected.id !== modelID) return;
  state.sheet.model = { providerID, id: modelID, variant: variant || "" };
  const option = [...document.querySelectorAll("#model-tree .model-option")].find(
    (item) => item.dataset.provider === providerID && item.dataset.model === modelID,
  );
  if (option) {
    for (const chip of option.querySelectorAll(".variant-chip")) {
      chip.classList.toggle("active", (chip.dataset.variant || "") === (variant || ""));
    }
  }
  updateModelSummary();
}

function toggleModelPicker() {
  const body = document.getElementById("model-picker-body");
  const button = document.querySelector('[data-action="toggle-model-picker"]');
  if (!body || !button) return;
  const open = body.hidden;
  body.hidden = !open;
  button.textContent = open ? "收起" : "选择模型";
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    filterModelPicker(document.getElementById("model-search")?.value || "");
    requestAnimationFrame(() => {
      const tree = document.getElementById("model-tree");
      const selected = tree?.querySelector(".model-option.selected");
      if (tree && selected) {
        const treeRect = tree.getBoundingClientRect();
        const rect = selected.getBoundingClientRect();
        if (rect.top < treeRect.top || rect.bottom > treeRect.bottom) {
          tree.scrollTop += rect.top - treeRect.top - 8;
        }
      }
      document.getElementById("model-search")?.focus({ preventScroll: true });
    });
  }
}


function computeActivity(active, sessions) {
  const byID = new Map((sessions || []).map((session) => [session.id, session]));
  const sessionRoots = {};

  // Walk parentID to the top-level session. OpenCode runs subagents in child
  // sessions, so the root is not in /api/session/active while a child is.
  for (const session of sessions || []) {
    let current = session;
    let guard = 0;
    while (current?.parentID && guard++ < 16) {
      const parent = byID.get(current.parentID);
      if (!parent) {
        current = { id: current.parentID };
        break;
      }
      current = parent;
    }
    sessionRoots[session.id] = current?.id || session.id;
  }

  const roots = {};
  for (const sessionID of Object.keys(active || {})) {
    const rootID = sessionRoots[sessionID] || sessionID;
    if (!roots[rootID]) roots[rootID] = { direct: false, subagents: 0, ids: [] };
    roots[rootID].ids.push(sessionID);
    if (rootID === sessionID) roots[rootID].direct = true;
    else roots[rootID].subagents += 1;
    // Keep the map complete even when a child was created after page load.
    if (!sessionRoots[sessionID]) sessionRoots[sessionID] = rootID;
  }

  return { roots, sessionRoots };
}

function sessionActivity(id) {
  return state.activity?.[id] || null;
}

function sessionStatus(id) {
  const activity = sessionActivity(id);
  if (activity?.direct) return "running";
  if (activity?.subagents) return "subagent";
  return "idle";
}

function statusLabel(status) {
  if (status === "running") return "运行中";
  if (status === "subagent") return "子代理运行中";
  return "空闲";
}

function statusBadgeClass(status) {
  if (status === "running") return "green";
  if (status === "subagent") return "amber";
  return "";
}

async function refreshActivity() {
  try {
    const before = state.sessionID ? sessionActivity(state.sessionID) : null;
    const [active, sessions] = await Promise.all([
      api("/api/active"),
      api("/api/sessions?limit=100&includeChildren=1"),
    ]);
    state.active = unwrap(active) || {};
    state.allSessions = unwrap(sessions) || [];
    const built = computeActivity(state.active, state.allSessions);
    state.activity = built.roots;
    state.sessionRoots = built.sessionRoots;
    state.lastActivitySync = Date.now();
    if (state.view === "sessions") updateSessionList();
    if (state.view === "session" && state.sessionID) {
      const after = sessionActivity(state.sessionID);
      if (before?.direct !== after?.direct || before?.subagents !== after?.subagents) {
        renderSession();
      }
    }
  } catch {
    // Status is best-effort; the transcript remains usable.
  }
}

function scheduleActivityRefresh() {
  clearTimeout(state.activityTimer);
  state.activityTimer = setTimeout(refreshActivity, 250);
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
    const [meta, sessions, allSessions, projects, active, schedules] = await Promise.all([
      api("/api/state"),
      api("/api/sessions?limit=50"),
      api("/api/sessions?limit=100&includeChildren=1"),
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
    state.allSessions = unwrap(allSessions) || [];
    state.projects = unwrap(projects) || [];
    state.active = unwrap(active) || {};
    const built = computeActivity(state.active, state.allSessions);
    state.activity = built.roots;
    state.sessionRoots = built.sessionRoots;
    state.schedules = unwrap(schedules) || [];
    state.lastSync = Date.now();
    state.lastActivitySync = Date.now();
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
            <div class="brand-title" title="${esc(title)}">${esc(title)}</div>
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
          const activity = sessionActivity(session.id);
          const status = sessionStatus(session.id);
          const model = session.model ? `${session.model.id}${session.model.variant ? `#${session.model.variant}` : ""}` : "";
          return `
            <article class="card link session-card" data-action="open-session" data-id="${esc(session.id)}" role="button" tabindex="0">
              <div class="session-copy">
                <div class="session-title">${esc(session.title || "未命名会话")}</div>
                <div class="session-meta">
                  <span class="dot ${status === "idle" ? "" : status}"></span>
                  <span>${statusLabel(status)}</span>
                  ${status !== "idle" && activity?.subagents ? `<span class="badge amber">${activity.subagents} 个子代理</span>` : ""}
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
  const status = sessionStatus(state.sessionID);
  const activity = sessionActivity(state.sessionID);
  const statusText = statusLabel(status);
  const model = session?.model ? modelLabel(session.model) : "";
  const messages = state.messages;
  const statusNote =
    status === "subagent"
      ? `${activity?.subagents || 1} 个子代理正在执行；主会话仍可接收消息`
      : status === "running"
        ? activity?.subagents
          ? `主会话与 ${activity.subagents} 个子代理正在运行`
          : "OpenCode 正在处理这一轮"
        : "现在发送会直接进入这个会话";

  app.innerHTML = `
    ${topbar({
      title,
      sub: `<span class="status-text ${status}">${statusText}</span> · ${esc(projectName(session?.location?.directory))} · ${esc(model || "默认模型")}`,
      back: true,
      actions: `
        ${state.deepLink ? `<a class="icon-btn" href="${esc(state.deepLink)}" target="_blank" rel="noopener noreferrer" aria-label="打开完整会话">${icon("link")}</a>` : ""}
        <button class="icon-btn" data-action="refresh-session" aria-label="刷新">${icon("refresh")}</button>
      `,
    })}
    <main class="content no-nav" id="messages">
      <div class="session-status ${status}">
        <span class="dot ${status === "idle" ? "" : status}"></span>
        <div class="session-status-copy">
          <strong>${statusText}</strong>
          <span>${esc(statusNote)}</span>
        </div>
        <span class="badge ${statusBadgeClass(status)}">${esc(model || "默认模型")}</span>
      </div>
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
            ? `<div class="empty"><div class="empty-icon">${icon("sessions", 24)}</div><h3>还没有消息</h3><p>在下面写一条消息，然后选择立即发送或定时发送。</p></div>`
            : `<div class="msg-list">${messages.map(renderMessage).join("")}</div>`
      }
      ${status !== "idle" ? `<div class="idle-divider">${statusText}…</div>` : ""}
    </main>
    <div class="composer">
      <div class="composer-context">
        <span class="dot ${status === "idle" ? "" : status}"></span>
        <span>发送到 <strong>${esc(title)}</strong></span>
        <span class="spacer"></span>
        <span class="status-text ${status} small">${statusText}</span>
      </div>
      <div class="composer-inner">
        <textarea id="composer-text" rows="1" placeholder="输入消息…">${esc(state.composerText)}</textarea>
      </div>
      <div class="composer-actions">
        <button class="composer-action primary" data-action="open-now-sheet">
          ${icon("send", 16)} 立即发送
        </button>
        <button class="composer-action" data-action="open-sheet" data-target="session">
          ${icon("clock", 16)} 定时发送
        </button>
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
          <h2 style="margin-bottom:8px">修改密码</h2>
          <p class="small muted" style="margin:0 0 12px">
            首次启动的初始密码只打印一次；如果是 agent 替你部署，应该由它私下转告你，并在登录后改掉。
          </p>
          <form id="password-form" class="stack">
            <div class="field">
              <label for="password-current">当前密码</label>
              <input class="input" id="password-current" type="password" autocomplete="current-password" />
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="password-new">新密码（至少 8 位）</label>
                <input class="input" id="password-new" type="password" autocomplete="new-password" minlength="8" />
              </div>
              <div class="field">
                <label for="password-confirm">再输一次</label>
                <input class="input" id="password-confirm" type="password" autocomplete="new-password" minlength="8" />
              </div>
            </div>
            <button class="btn primary" type="submit">更新密码</button>
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
    model: normalizeModel(config.model) || null,
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

  if (sheet.type === "new" && state.models && !sheet.model?.id) {
    const available = modelGroups().flatMap((group) => group.models);
    const preferred =
      available.find(
        (model) =>
          model.providerID === "opencode-go" &&
          /deepseek-v4\.1-flash/i.test(model.id || model.modelID || ""),
      ) ||
      available.find(
        (model) => model.providerID === "opencode-go" && /deepseek/i.test(model.id || model.modelID || ""),
      ) ||
      available.find((model) => /deepseek-v4\.1-flash/i.test(model.id || model.modelID || "")) ||
      available.find((model) => /deepseek/i.test(model.id || model.modelID || "")) ||
      available[0];
    if (preferred) {
      sheet.model = { providerID: preferred.providerID, id: preferred.id, variant: "" };
    }
  }

  const isEdit = sheet.type === "edit";
  const isNew = sheet.type === "new";
  const isNow = sheet.type === "now";
  const targetSessionID = sheet.sessionID || sheet.schedule?.target?.sessionID || null;
  const targetStatus = targetSessionID ? sessionStatus(targetSessionID) : "idle";
  const targetStatusText = statusLabel(targetStatus);
  const projectOptions = state.projects
    .map(
      (project) =>
        `<option value="${esc(project.canonical)}" ${sheet.directory === project.canonical ? "selected" : ""}>${esc(projectName(project.canonical))} — ${esc(project.canonical)}</option>`,
    )
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
        <div class="sheet-heading">
          <span class="sheet-eyebrow">${isNow ? "发送到指定会话" : isEdit ? "修改已有安排" : isNew ? "创建新会话" : "到点写入指定会话"}</span>
          <h2 id="sheet-title">${isEdit ? "编辑定时" : isNew ? "新建会话并定时" : isNow ? "立即发送" : "定时发送"}</h2>
        </div>
        <button class="icon-btn sheet-close" data-action="close-sheet" aria-label="关闭">${icon("close")}</button>
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
            <div class="field">
              <label>模型与思考深度</label>
              ${renderModelPicker(sheet)}
            </div>
            <div class="field">
              <label for="sheet-agent">Agent</label>
              <select class="select" id="sheet-agent"><option value="">默认</option>${agentOptions}</select>
            </div>`
          : `<div class="sheet-target">
              <div class="sheet-target-copy">
                <strong>${esc(sheet.targetTitle || state.session?.title || state.schedules.find((s) => s.id === sheet.schedule?.id)?.target?.title || "目标会话")}</strong>
                <span>${esc(projectName(sheet.targetDirectory || state.session?.location?.directory || sheet.schedule?.target?.directory))}</span>
              </div>
              <span class="badge ${statusBadgeClass(targetStatus)}"><span class="dot ${targetStatus === "idle" ? "" : targetStatus}"></span>${targetStatusText}</span>
            </div>`
      }

      <div class="field">
        <label for="sheet-text">消息</label>
        <textarea class="textarea" id="sheet-text" placeholder="${isNow ? "输入要立即发送的消息" : "输入要定时发送的消息"}">${esc(sheet.text)}</textarea>
      </div>

      ${
        isNow
          ? ""
          : `<div class="field">
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
      </div>`
      }

      ${
        isNow
          ? ""
          : `<details class="advanced" style="margin-top:14px">
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
      </details>`
      }

      ${
        isEdit
          ? `<div class="row" style="margin-top:16px">
              <button class="btn danger" data-action="delete-schedule" data-id="${esc(sheet.schedule?.id)}">取消这条</button>
              <span class="spacer"></span>
              <button class="btn primary" data-action="submit-sheet">保存</button>
            </div>`
          : `<button class="btn primary block sheet-submit" style="margin-top:16px" data-action="submit-sheet">${isNow ? "确认发送" : isNew ? "新建并定时" : "安排发送"}</button>`
      }
      <div class="field-hint" style="text-align:center;margin-top:10px">
        ${isNow ? "确认后立即发送，不会创建定时任务。" : "到点后若 OpenCode 离线，会在宽限时间内重试；超过宽限标记“已错过”。"}
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

function syncSheetField(target) {
  if (!state.sheet || !target) return;
  if (target.id === "sheet-text") state.sheet.text = target.value;
  if (target.id === "sheet-due") {
    state.sheet.due = target.value;
    updatePeakHint();
  }
  if (target.id === "sheet-busy") state.sheet.busyPolicy = target.value;
  if (target.id === "sheet-wait") state.sheet.waitMinutes = Number(target.value);
  if (target.id === "sheet-grace") state.sheet.graceMinutes = Number(target.value);
  if (target.id === "sheet-perm") state.sheet.permissionPolicy = target.value;
  if (target.id === "sheet-perm-timeout") state.sheet.permissionTimeoutMinutes = Number(target.value);
  if (target.id === "sheet-directory") state.sheet.directory = target.value;
  if (target.id === "sheet-new-title") state.sheet.title = target.value;
  if (target.id === "sheet-agent") state.sheet.agent = target.value;
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

function setButtonBusy(button, label) {
  if (!button) return;
  if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
  button.disabled = true;
  button.classList.add("is-loading");
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
}

function resetButton(button) {
  if (!button) return;
  button.disabled = false;
  button.classList.remove("is-loading");
  if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
}

async function submitSheet() {
  const sheet = state.sheet;
  if (!sheet) return;
  const text = document.getElementById("sheet-text")?.value?.trim() || "";
  if (!text) return toast("写一条消息再发送", "error");

  const button = document.querySelector('[data-action="submit-sheet"]');

  if (sheet.type === "now") {
    if (!sheet.sessionID) return toast("没有目标会话", "error");
    setButtonBusy(button, "正在发送…");
    try {
      await api(`/api/sessions/${encodeURIComponent(sheet.sessionID)}/send`, {
        method: "POST",
        body: { text },
      });
      state.composerText = "";
      closeSheet();
      toast("已发送");
      await refreshSession();
    } catch (error) {
      toast(error.message, "error");
      resetButton(button);
    }
    return;
  }

  const dueLocal = document.getElementById("sheet-due")?.value || "";
  if (!dueLocal) return toast("选一个发送时间", "error");
  const dueAt = new Date(dueLocal).getTime();
  if (!Number.isFinite(dueAt)) return toast("时间格式不对", "error");
  if (dueAt <= Date.now()) return toast("发送时间已经过去，请重新选择", "error");

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
    if (sheet.model?.providerID && sheet.model?.id) {
      payload.model = {
        providerID: sheet.model.providerID,
        id: sheet.model.id,
        ...(sheet.model.variant ? { variant: sheet.model.variant } : {}),
      };
    }
    const agent = document.getElementById("sheet-agent")?.value;
    if (agent) payload.agent = agent;
  } else {
    payload.target = { kind: "session", sessionID: sheet.sessionID };
  }

  setButtonBusy(button, "正在安排…");
  try {
    await api("/api/schedules", { method: "POST", body: payload });
    state.composerText = "";
    closeSheet();
    toast("已安排，可在队列查看");
    await refreshSchedules();
    state.queueTab = "active";
    location.hash = "#/q";
  } catch (error) {
    toast(error.message, "error");
    resetButton(button);
  }
}

async function saveEdit(id, payload) {
  const button = document.querySelector('[data-action="submit-sheet"]');
  setButtonBusy(button, "正在保存…");
  try {
    await api(`/api/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
    closeSheet();
    toast("已更新");
    await refreshSchedules();
    render();
  } catch (error) {
    toast(error.message, "error");
    resetButton(button);
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
  if (!confirm("取消这条定时消息？")) return false;
  try {
    await api(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("已取消");
    await refreshSchedules();
    render();
    return true;
  } catch (error) {
    toast(error.message, "error");
    return false;
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
  if (state.sheet) state.sheet.due = input.value;
  updatePeakHint();
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
    const sessionID = event.sessionID;
    if (sessionID) {
      const known = state.allSessions.some((session) => session.id === sessionID);
      const rootID = state.sessionRoots[sessionID] || sessionID;
      const previousStatus = sessionStatus(rootID);
      if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.idle") {
        delete state.active[sessionID];
      } else if (event.type === "session.execution.started") {
        state.active[sessionID] = { type: "running" };
      }
      const built = computeActivity(state.active, state.allSessions);
      state.activity = built.roots;
      state.sessionRoots = built.sessionRoots;
      const nextStatus = sessionStatus(rootID);
      if (state.view === "sessions") updateSessionList();
      if (state.sessionID === rootID && previousStatus !== nextStatus) renderSession();
      if (!known) scheduleActivityRefresh();
    }
    const rootID = sessionID ? state.sessionRoots[sessionID] || sessionID : state.sessionID;
    if (state.sessionID && rootID === state.sessionID) {
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
            <label for="token">密码</label>
            <input class="input" id="token" type="password" autocomplete="current-password" placeholder="首次部署时给出的初始密码" autofocus />
          </div>
          <div class="login-error" id="login-error">${esc(error)}</div>
          <button class="btn primary block" type="submit">进入</button>
        </form>
        <div class="field-hint" style="margin-top:14px">
          首次启动会打印一次初始密码；登录后在「设置 → 修改密码」改成你自己的密码。忘记可在终端运行 <code>ocsched --rotate-token</code>，然后重启服务。
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
    if (error) {
      error.textContent =
        err.message === "invalid_token" || err.message === "unauthorized"
          ? "密码不正确"
          : err.message;
    }
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
  if (action === "open-now-sheet") {
    openSheet({ type: "now", sessionID: state.sessionID });
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
    cancelSchedule(id).then((cancelled) => {
      if (cancelled) closeSheet();
    });
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

// The sheet lives in #sheet-host, a sibling of #app. Without this listener
// every button inside the sheet (close, quick time, submit) is dead.
sheetHost.addEventListener("click", (event) => {
  if (event.target.classList.contains("sheet-backdrop")) {
    closeSheet();
    return;
  }
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl || !sheetHost.contains(actionEl)) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  if (action === "close-sheet") {
    closeSheet();
    return;
  }
  if (action === "submit-sheet") {
    submitSheet();
    return;
  }
  if (action === "quick-time") {
    setQuickTime(actionEl.dataset.when);
    return;
  }
  if (action === "toggle-model-picker") {
    toggleModelPicker();
    return;
  }
  if (action === "model-select") {
    selectSheetModel(actionEl.dataset.provider, actionEl.dataset.model);
    return;
  }
  if (action === "model-variant") {
    selectSheetVariant(actionEl.dataset.provider, actionEl.dataset.model, actionEl.dataset.variant || "");
    return;
  }
  if (action === "delete-schedule") {
    cancelSchedule(id).then((cancelled) => {
      if (cancelled) closeSheet();
    });
  }
});

sheetHost.addEventListener("input", (event) => {
  if (event.target.closest?.("#sheet-root")) {
    syncSheetField(event.target);
    if (event.target.id === "model-search") filterModelPicker(event.target.value);
  }
});

sheetHost.addEventListener("change", (event) => {
  if (event.target.closest?.("#sheet-root")) syncSheetField(event.target);
});

sheetHost.addEventListener("search", (event) => {
  if (event.target.id === "model-search") filterModelPicker(event.target.value);
});

app.addEventListener("input", (event) => {
  if (state.sheet && event.target.closest?.("#sheet-root")) {
    syncSheetField(event.target);
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
    if (state.sheet) state.sheet.busyPolicy = event.target.value;
    if (state.sheet && event.target.value === "wait") {
      const waitInput = document.getElementById("sheet-wait");
      if (waitInput) {
        event.target.options[0].textContent = `等空闲（最多 ${Number(waitInput.value)} 分钟）`;
      }
    }
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
    return;
  }
  if (event.target.id === "password-form") {
    const currentPassword = document.getElementById("password-current")?.value || "";
    const newPassword = document.getElementById("password-new")?.value || "";
    const confirm = document.getElementById("password-confirm")?.value || "";
    if (newPassword.length < 8) {
      toast("新密码至少 8 位", "error");
      return;
    }
    if (newPassword !== confirm) {
      toast("两次输入的新密码不一致", "error");
      return;
    }
    api("/api/auth/password", {
      method: "POST",
      body: { currentPassword, newPassword },
    })
      .then(() => {
        toast("密码已更新");
        event.target.reset();
      })
      .catch((error) =>
        toast(error.message === "invalid_password" ? "当前密码不正确" : error.message, "error"),
      );
  }
});

app.addEventListener("keydown", (event) => {
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
  if (Date.now() - state.lastActivitySync < 45_000) return;
  refreshActivity();
}, 45_000);

init();
