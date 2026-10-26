import { randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export const VERSION = "0.1.0";

/** @param {string} prefix */
export function newID(prefix) {
  return `${prefix}${randomBytes(12).toString("hex")}`;
}

export const newScheduleID = () => newID("sch_");
export const newRunID = () => newID("run_");
export const newMessageID = () => newID("msg_");

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

/** Constant-time string comparison. Handles unequal lengths without leaking. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function hmac(secret, value) {
  return createHmac("sha256", secret).update(String(value)).digest("base64url");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** URL-safe base64 of a UTF-8 string, without padding. */
export function base64url(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

export function toIso(ms) {
  if (ms === null || ms === undefined) return null;
  const date = new Date(Number(ms));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function fromIso(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function isAbsolutePath(value) {
  return typeof value === "string" && value.startsWith("/");
}

export function truncate(value, max = 200) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 99 };
let currentLevel = LEVELS.info;

export function setLogLevel(level) {
  if (level in LEVELS) currentLevel = LEVELS[level];
}

export function log(level, message, fields) {
  if (LEVELS[level] < currentLevel) return;
  const time = new Date().toISOString();
  const suffix = fields ? ` ${JSON.stringify(fields, redactReplacer)}` : "";
  const line = `${time} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.error(line);
  else console.log(line);
}

const SECRET_KEYS = /pass(word)?|token|secret|authorization|cookie/i;
function redactReplacer(key, value) {
  if (SECRET_KEYS.test(key) && typeof value === "string") return "[redacted]";
  return value;
}

export function redact(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) out[key] = "[redacted]";
    else if (val && typeof val === "object") out[key] = redact(val);
    else out[key] = val;
  }
  return out;
}

export function isValidTimezone(zone) {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatInZone(ms, zone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

export function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(value).trim());
  if (!match) return null;
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.round(Number(match[1]) * units[(match[2] || "b").toLowerCase()]);
}
