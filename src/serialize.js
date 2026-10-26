import { toIso } from "./util.js";

/** Convert a snake_case database row into the public camelCase shape. */
export function scheduleView(row) {
  if (!row) return null;
  return {
    id: row.id,
    target: {
      kind: row.target_kind,
      sessionID: row.session_id,
      directory: row.directory,
      title: row.title,
      agent: row.agent,
      model:
        row.model_id || row.model_provider
          ? {
              providerID: row.model_provider,
              id: row.model_id,
              variant: row.model_variant,
            }
          : null,
    },
    text: row.text,
    dueAt: row.due_at,
    dueAtISO: toIso(row.due_at),
    timezone: row.timezone,
    state: row.state,
    busyPolicy: row.busy_policy,
    waitMinutes: row.wait_minutes,
    graceMinutes: row.grace_minutes,
    permissionPolicy: row.permission_policy,
    permissionTimeoutMinutes: row.permission_timeout_minutes,
    attempt: row.attempt,
    messageID: row.idem_msg_id,
    resultSessionID: row.result_session_id,
    resultMessageID: row.result_message_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    createdAtISO: toIso(row.created_at),
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    sentAtISO: toIso(row.sent_at),
    finishedAt: row.finished_at,
    finishedAtISO: toIso(row.finished_at),
    notBefore: row.not_before,
    waitDeadline: row.wait_deadline,
    active: ["pending", "waiting", "sending", "accepted"].includes(row.state),
  };
}

/** Compact a message for the PWA's transcript view. */
export function messageView(message) {
  if (!message) return null;
  const base = {
    id: message.id,
    type: message.type,
    created: message.time?.created ?? null,
    agent: message.agent ?? null,
    model: message.model ?? null,
    cost: message.cost ?? null,
    tokens: message.tokens ?? null,
  };
  if (message.type === "user") {
    return {
      ...base,
      text: message.text ?? "",
      files: (message.files ?? []).map((file) => file.name || file.path || file.url).filter(Boolean),
    };
  }
  if (message.type === "assistant") {
    const parts = [];
    for (const part of message.content ?? []) {
      if (part.type === "text") {
        parts.push({ kind: "text", text: part.text ?? "" });
      } else if (part.type === "reasoning") {
        parts.push({ kind: "reasoning", text: part.text ?? "" });
      } else if (part.type === "tool") {
        parts.push({
          kind: "tool",
          name: part.name ?? "tool",
          status: part.state?.status ?? "unknown",
          input: part.state?.input ?? null,
          output: summarizeToolOutput(part.state),
        });
      }
    }
    return { ...base, parts, finish: message.finish ?? null };
  }
  if (message.type === "idle") {
    return { ...base, outcome: message.outcome ?? null };
  }
  return { ...base, text: message.text ?? "" };
}

function summarizeToolOutput(state) {
  const content = state?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((item) => (item?.type === "text" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
  if (!text) return null;
  return text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
}
