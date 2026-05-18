#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(appDir, "..");
const dataDir = path.join(rootDir, "data");
const uploadsDir = path.join(dataDir, "uploads");
const logsDir = path.join(rootDir, "logs");
const clientDistDir = path.join(appDir, "dist", "client");
const serverEntry = path.join(appDir, "dist", "server", "server", "index.js");
const bundledNode = process.execPath;
const preferredServerPort = Number(process.env.APP_SERVER_PORT ?? 3000);
const openBrowser = process.env.APP_OPEN_BROWSER !== "0";

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
}

async function findFreePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
    });

    if (available) {
      return port;
    }
  }

  throw new Error(`Unable to find a free port starting at ${startPort}`);
}

function openUrl(url) {
  const tuple =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  const child = spawn(tuple[0], tuple[1], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function teeLines(stream, label, target, logStream) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    const output = `[${label}] ${line}\n`;
    target.write(output);
    logStream.write(output);
  });
}

function createLogStream() {
  const logFile = path.join(logsDir, "latest.log");
  return fs.createWriteStream(logFile, { flags: "a" });
}

async function main() {
  ensureDirectory(dataDir);
  ensureDirectory(uploadsDir);
  ensureDirectory(logsDir);

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Packaged server entry not found: ${serverEntry}`);
  }
  if (!fs.existsSync(clientDistDir)) {
    throw new Error(`Packaged client build not found: ${clientDistDir}`);
  }

  const serverPort = await findFreePort(preferredServerPort);
  const adminUrl = `http://localhost:${serverPort}/admin/operations`;
  const liveUrl = `http://localhost:${serverPort}/overlay/live`;
  const logStream = createLogStream();

  process.stdout.write(`[portable] server port: ${serverPort}\n`);
  process.stdout.write(`[portable] admin url: ${adminUrl}\n`);
  process.stdout.write(`[portable] live overlay url: ${liveUrl}\n`);
  process.stdout.write(`[portable] logs: ${path.join(logsDir, "latest.log")}\n`);

  logStream.write(`[portable] started ${new Date().toISOString()}\n`);
  logStream.write(`[portable] admin url: ${adminUrl}\n`);
  logStream.write(`[portable] live overlay url: ${liveUrl}\n`);

  if (openBrowser) {
    openUrl(adminUrl);
  }

  const child = spawn(bundledNode, [serverEntry], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(serverPort),
      APP_ROOT_DIR: rootDir,
      APP_DATA_DIR: dataDir,
      APP_UPLOADS_DIR: uploadsDir,
      APP_CLIENT_DIST_DIR: clientDistDir,
      APP_LOG_DIR: logsDir
    },
    stdio: ["inherit", "pipe", "pipe"]
  });

  if (child.stdout) {
    teeLines(child.stdout, "server", process.stdout, logStream);
  }
  if (child.stderr) {
    teeLines(child.stderr, "server", process.stderr, logStream);
  }

  let shuttingDown = false;
  const shutdown = (signal = "SIGTERM") => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

  logStream.write(`[portable] exited with code ${Number(exitCode)}\n`);
  logStream.end();
  process.exit(Number(exitCode));
}

main().catch((error) => {
  process.stderr.write(`[portable] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

