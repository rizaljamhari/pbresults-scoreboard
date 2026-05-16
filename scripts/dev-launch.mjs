#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import readline from "node:readline";

const env = { ...process.env };
const preferredClientPort = Number(env.APP_CLIENT_PORT ?? 5173);
const preferredServerPort = Number(env.APP_SERVER_PORT ?? 3000);
const openBrowser = env.APP_OPEN_BROWSER === "1";

function getPnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
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

function prefixed(stream, label, target) {
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => target.write(`[${label}] ${line}\n`));
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

async function main() {
  const clientPort = await findFreePort(preferredClientPort);
  const serverPort = await findFreePort(preferredServerPort === clientPort ? preferredServerPort + 1 : preferredServerPort);
  const adminUrl = `http://localhost:${clientPort}/admin/settings`;

  process.stdout.write(`[dev] client port: ${clientPort}\n`);
  process.stdout.write(`[dev] server port: ${serverPort}\n`);
  process.stdout.write(`[dev] admin url: ${adminUrl}\n`);

  if (openBrowser) {
    openUrl(adminUrl);
  }

  const childEnv = {
    ...env,
    APP_CLIENT_PORT: String(clientPort),
    APP_SERVER_PORT: String(serverPort),
    PORT: String(serverPort)
  };

  const processes = [
    {
      label: "server",
      child: spawn(getPnpmCommand(), ["dev:server"], { env: childEnv, stdio: ["inherit", "pipe", "pipe"] })
    },
    {
      label: "client",
      child: spawn(getPnpmCommand(), ["dev:client"], { env: childEnv, stdio: ["inherit", "pipe", "pipe"] })
    }
  ];

  for (const { label, child } of processes) {
    if (child.stdout) {
      prefixed(child.stdout, label, process.stdout);
    }
    if (child.stderr) {
      prefixed(child.stderr, label, process.stderr);
    }
  }

  let shuttingDown = false;
  const shutdown = (signal = "SIGTERM") => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const { child } of processes) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const result = await Promise.race(
    processes.map(
      ({ label, child }) =>
        new Promise((resolve) => {
          child.on("exit", (code, signal) => resolve({ label, code: code ?? (signal ? 1 : 0) }));
        })
    )
  );

  shutdown("SIGTERM");
  if (Number(result.code) !== 0) {
    process.stderr.write(`[dev] ${result.label} exited with code ${result.code}\n`);
  }
  setTimeout(() => process.exit(Number(result.code)), 50);
}

main().catch((error) => {
  process.stderr.write(`[dev] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
