import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";import { spawn } from "node:child_process";
import { loadConfig, printTokenBanner, configSummary } from "./config.js";
import { Store } from "./store.js";
import { OpenCodeClient } from "./opencode.js";
import { EventHub } from "./eventhub.js";
import { Scheduler } from "./scheduler.js";
import { createApp } from "./http.js";
import { log, setLogLevel, VERSION } from "./util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(HERE, "../bin/ocsched.js");

const HELP = `OpenCode Scheduled Messages ${VERSION}

Schedule a message into an existing OpenCode V2 session (or a new one) and
let it send later — for example during DeepSeek off-peak hours.

USAGE
  ocsched [options]
  ocsched doctor
  ocsched service print [--systemd]
  ocsched service install --yes

OPTIONS
  --port <n>                 HTTP port (default 8788)
  --bind <host>              Bind address (default 127.0.0.1)
  --lan                      Shortcut for --bind 0.0.0.0
  --public-url <url>         Public URL of this gateway (for deep links)
  --opencode-url <url>       OpenCode server (default from service.json)
  --opencode-public-url <u>  Public URL of the OpenCode web UI
  --data-dir <dir>           Override the data directory
  --config-dir <dir>         Override the config directory
  --rotate-token             Issue a new access token and print it
  --log-level <level>        trace|debug|info|warn|error|silent
  --version, -v              Print version
  --help, -h                 Print help

ENVIRONMENT
  OPENCODE_BASE_URL, OPENCODE_PASSWORD, OCSM_TOKEN,
  OCSM_CONFIG_DIR, OCSM_DATA_DIR

EXAMPLES
  npx opencode-scheduled-messages
  npx opencode-scheduled-messages --lan
  ocsched service print
`;

function parseArgs(argv) {
  const out = { _: [] };
  const flags = new Set(["--lan", "--rotate-token", "--yes"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      out.version = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const equal = arg.indexOf("=");
      const key = equal === -1 ? arg.slice(2) : arg.slice(2, equal);
      if (flags.has(`--${key}`)) {
        out[key] = true;
        continue;
      }
      const value = equal === -1 ? argv[index + 1] : arg.slice(equal + 1);
      if (equal === -1) index += 1;
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      out[key] = value;
      continue;
    }
    out._.push(arg);
  }
  return out;
}

function lanAddresses() {
  const out = [];
  try {
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === "IPv4" && !address.internal) out.push({ name, address: address.address });
      }
    }
  } catch (error) {
    log("warn", "Cannot enumerate network interfaces", { error: error.message });
  }
  return out;
}

function logo() {
  return [
    "",
    `  OpenCode Scheduled Messages v${VERSION}`,
    "  write at peak · send off-peak · keep the thread",
    "",
  ].join("\n");
}

async function runServer(args) {
  process.umask(0o077);
  if (args["data-dir"]) process.env.OCSM_DATA_DIR = path.resolve(args["data-dir"]);
  if (args["config-dir"]) process.env.OCSM_CONFIG_DIR = path.resolve(args["config-dir"]);
  if (args["log-level"]) setLogLevel(args["log-level"]);

  const overrides = {
    ...(args.port ? { port: Number(args.port) } : {}),
    ...(args.bind ? { bind: args.bind } : {}),
    ...(args.lan ? { bind: "0.0.0.0" } : {}),
    ...(args["public-url"] ? { publicUrl: args["public-url"] } : {}),
    ...(args["opencode-url"] ? { opencode: { baseUrl: args["opencode-url"] } } : {}),
    ...(args["opencode-public-url"] ? { opencode: { publicUrl: args["opencode-public-url"] } } : {}),
    ...(args["rotate-token"] ? { rotateToken: true } : {}),
  };

  const { config, paths, createdToken, baseUrl, password } = await loadConfig({ overrides });
  if (createdToken) printTokenBanner(createdToken, paths);

  if (args["rotate-token"]) {
    log("info", "Token rotated. Restart the service to apply it:");
    console.log("  systemctl --user restart ocsched.service");
    return { config, paths };
  }

  if (!password) {
    log("warn", "No OpenCode password found. If the server requires auth, set OPENCODE_PASSWORD.");
  }

  const store = new Store(paths.databaseFile);
  const client = new OpenCodeClient({
    baseUrl,
    password,
    publicUrl: config.opencode.publicUrl,
  });
  const eventhub = new EventHub({ client });
  const scheduler = new Scheduler({ store, client, config });
  const app = createApp({ config, paths, store, client, scheduler, eventhub });

  const address = await app.listen({ host: config.bind, port: config.port });
  const actualPort = typeof address === "object" && address ? address.port : config.port;
  const health = await client.health();

  process.stdout.write(logo());
  console.log(`  Local     http://127.0.0.1:${actualPort}`);
  if (config.bind === "0.0.0.0" || config.bind === "::") {
    for (const { name, address: ip } of lanAddresses()) {
      console.log(`  LAN       http://${ip}:${actualPort}   (${name})`);
    }
    if (!config.publicUrl) console.log("  Phone     use a LAN IP above, or put Tailscale/Cloudflare in front");
  } else if (config.bind !== "127.0.0.1" && config.bind !== "localhost") {
    console.log(`  Bind      http://${config.bind}:${actualPort}`);
  }
  if (config.publicUrl) console.log(`  Public    ${config.publicUrl}`);
  console.log(
    `  OpenCode  ${baseUrl}  ${health.ok ? `connected (v${health.info?.version || "?"})` : `OFFLINE — ${health.error}`}`,
  );
  console.log(`  Data      ${paths.databaseFile}`);
  console.log(`  Config    ${paths.configFile}`);
  if (!config.publicUrl) {
    console.log(
      "  Tip       set --opencode-public-url https://<host>:8443 for one-tap full-session links",
    );
  }
  console.log("");

  eventhub.start();
  scheduler.start();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `Received ${signal}; shutting down`);
    scheduler.stop();
    eventhub.stop();
    await app.close().catch(() => {});
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return { config, paths, store, client, eventhub, scheduler, app };
}

async function runDoctor() {
  const { config, paths, baseUrl, password } = await loadConfig({});
  const client = new OpenCodeClient({ baseUrl, password });
  const health = await client.health();
  let store = null;
  let stats = null;
  let dbError = null;
  try {
    store = new Store(paths.databaseFile);
    stats = store.stats();
  } catch (error) {
    dbError = error.message;
  } finally {
    store?.close();
  }
  const summary = configSummary(config, paths, baseUrl);
  console.log(JSON.stringify({ ...summary, health, stats, dbError }, null, 2));
  if (!health.ok) process.exitCode = 2;
}

function systemdUnit({ config, paths }) {
  const node = process.execPath;
  const home = os.homedir();
  const readWrite = [paths.dataDir, paths.configDir].join(" ");
  return `[Unit]
Description=OpenCode Scheduled Messages
Documentation=https://github.com/EaveBounty/opencode-scheduled-messages
After=network-online.target opencode.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${path.resolve(HERE, "..")}
ExecStart=${node} ${BIN} --bind ${config.bind} --port ${config.port}
Environment=NODE_ENV=production
Environment=OPENCODE_BASE_URL=${config.opencode.baseUrl}
Restart=always
RestartSec=5
StartLimitBurst=10
TimeoutStopSec=15

# Keep this service from ever competing with OpenCode for the whole machine.
MemoryHigh=192M
MemoryMax=320M
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${readWrite}
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
LockPersonality=yes

[Install]
WantedBy=default.target
`;
}

async function serviceCommand(args) {
  const action = args._[1] || "print";
  const { config, paths } = await loadConfig({});
  const unit = systemdUnit({ config, paths });
  if (action === "print") {
    process.stdout.write(unit);
    return;
  }
  if (action !== "install") throw new Error(`Unknown service action: ${action}`);
  if (!args.yes) {
    console.error("Refusing to modify systemd without --yes.");
    console.error("Preview first: ocsched service print");
    process.exitCode = 2;
    return;
  }
  const dir = path.join(os.homedir(), ".config", "systemd", "user");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "ocsched.service");
  await writeFile(file, unit, { mode: 0o644 });
  console.log(`Wrote ${file}`);
  const run = (command, argv) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, argv, { stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
      child.on("error", reject);
    });
  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", ["--user", "enable", "--now", "ocsched.service"]);
  console.log("Enabled ocsched.service");
  console.log("Logs: journalctl --user -u ocsched -f");
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }
  const command = args._[0];
  if (command === "doctor") return runDoctor();
  if (command === "service") return serviceCommand(args);
  if (command && command !== "serve") throw new Error(`Unknown command: ${command}`);
  return runServer(args);
}
