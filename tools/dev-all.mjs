/**
 * One command, one origin: `npm run dev`.
 *
 * ARBITER is four surfaces (landing, product app, deliberation client, API) that
 * used to be four separate localhost ports, which in practice meant nobody could
 * say which port was "Arbiter". This script starts all four and fronts them with
 * the landing app's dev server on ONE public address:
 *
 *   http://localhost:5173/               landing page
 *   http://localhost:5173/app/           product app   (apps/web, hash-routed)
 *   http://localhost:5173/deliberation/  deliberation  (apps/deliberation)
 *   http://localhost:5173/api/...        API           (services/api)
 *
 * The routing itself lives in apps/landing/vite.config.ts (server.proxy); this
 * file only assigns the internal ports those proxy entries name. Everything binds
 * 127.0.0.1 explicitly because a bare "localhost" bind on this machine has
 * already produced an IPv6-only server the browser could not reach.
 *
 * --strictPort everywhere: if a port is taken the process dies loudly instead of
 * sliding to the next port and silently detaching from the proxy table.
 */
import { spawn } from "node:child_process";

const ENTRY_PORT = 5173;

const SERVERS = [
  {
    name: "api",
    args: ["run", "api"],
  },
  {
    name: "web",
    args: ["run", "dev", "-w", "@arbiter/web", "--",
      "--host", "127.0.0.1", "--port", "5273", "--strictPort", "--base", "/app/"],
  },
  {
    name: "delib",
    args: ["run", "dev", "-w", "@arbiter/deliberation", "--",
      "--host", "127.0.0.1", "--port", "5274", "--strictPort", "--base", "/deliberation/"],
  },
  {
    name: "entry",
    args: ["run", "dev", "-w", "@arbiter/landing", "--",
      "--host", "127.0.0.1", "--port", String(ENTRY_PORT), "--strictPort"],
  },
];

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  // SIGTERM is delivered async; give the children a beat before following them.
  setTimeout(() => process.exit(code), 300).unref();
}

for (const { name, args } of SERVERS) {
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"] });
  const tag = `[${name}]`.padEnd(8);
  const relay = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.trim() !== "") out.write(`${tag}${line}\n`);
      }
    });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    // One surface dying quietly turns "one server" back into a guessing game, so
    // any exit takes the whole group down and says which process started it.
    if (!shuttingDown) {
      console.error(`${tag}exited with code ${code} - stopping the rest`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

setTimeout(() => {
  console.log("");
  console.log(`ARBITER  http://localhost:${ENTRY_PORT}/`);
  console.log(`         http://localhost:${ENTRY_PORT}/app/           product app`);
  console.log(`         http://localhost:${ENTRY_PORT}/deliberation/  deliberation`);
  console.log(`         http://localhost:${ENTRY_PORT}/api            API`);
  console.log("");
}, 2500);
