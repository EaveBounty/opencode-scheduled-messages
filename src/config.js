import { readFileSync } from "node:fs";
import { mkdir, writeFile, chmod, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { randomToken, log } from "./util.js";

const APP_DIR = "opencode-scheduled-messages";
const DEFAULTS = {
  version: 1,
  bind: "127.0.0.1",
  port: 8788,
  publicUrl: null,
  opencode: {
    baseUrl: null,
    publicUrl: null,
  },
  auth: {
    cookieName: "ocsm_session",
    sessionDays: 30,
  },
  defaults: {
    timezone: "Asia/Shanghai",
    busyPolicy: "wait",
    waitMinutes: 30,
    graceMinutes: 120,
    permissionPolicy: "wait",
    permissionTimeoutMinutes: 10,
  },
  ui: {
    showCost: true,
    compactMessages: 30,
  },
};

export function defaultPaths(env = process.env) {
  const home = os.homedir();
  const configDir =
    env.OCSM_CONFIG_DIR ||
    (env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, APP_DIR) : path.join(home, ".config", APP_DIR));
  const dataDir =
    env.OCSM_DATA_DIR ||
    (env.XDG_DATA_HOME ? path.join(env.XDG_DATA_HOME, APP_DIR) : path.join(home, ".local", "share", APP_DIR));
  return {
    home,
    configDir,
    dataDir,
    configFile: path.join(configDir, "config.json"),
    databaseFile: path.join(dataDir, "state.db"),
  };
}

function hashToken(token) {
  return createHash("sha256").update(`ocsm:${token}`).digest("base64url");
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function mergeDefaults(config) {
  return {
    ...structuredClone(DEFAULTS),
    ...config,
    opencode: { ...DEFAULTS.opencode, ...(config?.opencode || {}) },
    auth: { ...DEFAULTS.auth, ...(config?.auth || {}) },
    defaults: { ...DEFAULTS.defaults, ...(config?.defaults || {}) },
    ui: { ...DEFAULTS.ui, ...(config?.ui || {}) },
  };
}

function opencodeStateCandidates(env) {
  return [
    path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode", "service.json"),
    path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode", "service.json"),
  ];
}

/** Read the password OpenCode uses for its local HTTP API. Never log it. */
export function resolveOpenCodePassword(config, env = process.env) {
  if (env.OPENCODE_PASSWORD) return env.OPENCODE_PASSWORD;
  if (config?.opencode?.password) return config.opencode.password;
  for (const file of opencodeStateCandidates(env)) {
    const data = readJson(file);
    if (data?.password) return data.password;
  }
  return null;
}

/** Derive the local OpenCode base URL from config or its service.json. */
export function resolveOpenCodeBaseUrl(config, env = process.env) {
  if (env.OPENCODE_BASE_URL) return env.OPENCODE_BASE_URL.replace(/\/+$/, "");
  if (config?.opencode?.baseUrl) return config.opencode.baseUrl.replace(/\/+$/, "");
  for (const file of opencodeStateCandidates(env)) {
    const data = readJson(file);
    if (!data?.port) continue;
    let host = data.hostname || "127.0.0.1";
    if (host === "0.0.0.0" || host === "::") host = "127.0.0.1";
    return `http://${host}:${data.port}`;
  }
  return "http://127.0.0.1:4096";
}

/** Only these fields are written to disk. Secrets are kept separately. */
function persisted(config) {
  return {
    version: config.version,
    bind: config.bind,
    port: config.port,
    publicUrl: config.publicUrl,
    opencode: {
      baseUrl: config.opencode.baseUrl,
      publicUrl: config.opencode.publicUrl,
      ...(config.opencode.password ? { password: config.opencode.password } : {}),
    },
    auth: {
      cookieName: config.auth.cookieName,
      sessionDays: config.auth.sessionDays,
      tokenHash: config.auth.tokenHash,
      cookieSecret: config.auth.cookieSecret,
    },
    defaults: config.defaults,
    ui: config.ui,
  };
}

export async function loadConfig({ env = process.env, overrides = {} } = {}) {
  const paths = defaultPaths(env);
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.dataDir, { recursive: true, mode: 0o700 });

  const existing = readJson(paths.configFile);
  const explicitPassword = existing?.opencode?.password || null;
  let config = mergeDefaults(existing || {});
  let createdToken = null;

  // Environment token wins for containers and automated tests.
  if (env.OCSM_TOKEN) config.auth.tokenHash = hashToken(env.OCSM_TOKEN);

  if (!config.auth.tokenHash) {
    createdToken = randomToken(24);
    config.auth.tokenHash = hashToken(createdToken);
  }
  if (!config.auth.cookieSecret) config.auth.cookieSecret = randomToken(32);

  if (overrides.rotateToken) {
    createdToken = randomToken(24);
    config.auth.tokenHash = hashToken(createdToken);
    config.auth.cookieSecret = randomToken(32);
  }

  const { rotateToken: _drop, ...safeOverrides } = overrides;
  config = {
    ...config,
    ...safeOverrides,
    opencode: { ...config.opencode, ...(safeOverrides.opencode || {}) },
    auth: { ...config.auth, ...(safeOverrides.auth || {}) },
    defaults: { ...config.defaults, ...(safeOverrides.defaults || {}) },
    ui: { ...config.ui, ...(safeOverrides.ui || {}) },
  };

  const password = resolveOpenCodePassword({ ...config, opencode: { ...config.opencode, password: explicitPassword } }, env);
  const baseUrl = resolveOpenCodeBaseUrl(config, env);
  config.opencode = {
    ...config.opencode,
    baseUrl,
    password: explicitPassword,
    passwordConfigured: Boolean(password),
  };

  const disk = persisted(config);
  if (!existing || JSON.stringify(existing) !== JSON.stringify(disk)) {
    await saveConfig(paths.configFile, disk);
  }

  return { config, paths, createdToken, baseUrl, password };
}

export async function saveConfig(file, config) {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

export async function persistConfig(paths, config) {
  await saveConfig(paths.configFile, persisted(config));
}

export function configSummary(config, paths, baseUrl) {
  return {
    configFile: paths.configFile,
    databaseFile: paths.databaseFile,
    bind: config.bind,
    port: config.port,
    publicUrl: config.publicUrl,
    opencode: {
      baseUrl,
      passwordConfigured: Boolean(config.opencode.passwordConfigured),
      publicUrl: config.opencode.publicUrl,
    },
    defaults: config.defaults,
  };
}

export function tokenHash(token) {
  return hashToken(token);
}

export function printTokenBanner(token, paths) {
  const line = "─".repeat(64);
  console.error(`\n${line}`);
  console.error("  Access token (shown once; store it now)");
  console.error(`  ${token}`);
  console.error(`  Config: ${paths.configFile}`);
  console.error("  Lost it? Run with --rotate-token to issue a new one.");
  console.error(`${line}\n`);
  log("info", "Generated a new access token");
}
