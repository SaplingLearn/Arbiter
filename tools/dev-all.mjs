/**
 * One command, one origin: `npm run dev`.
 *
 * ARBITER's frontend used to be separate dev servers on separate ports, which in
 * practice meant nobody could say which port was "Arbiter". This script starts
 * every surface and fronts them with the landing app's dev server on ONE public
 * address:
 *
 *   http://localhost:5173/               landing page
 *   http://localhost:5173/deliberation/  the product   (apps/deliberation)
 *   http://localhost:5173/api/...        API           (services/api)
 *
 * The routing itself lives in apps/landing/vite.config.ts (server.proxy); this
 * file only assigns the internal ports those proxy entries name. Everything binds
 * 127.0.0.1 explicitly because a bare "localhost" bind on this machine has
 * already produced an IPv6-only server the browser could not reach while curl
 * could.
 *
 * --strictPort everywhere: if a port is taken the process dies loudly instead of
 * sliding to the next port and silently detaching from the proxy table. That
 * failure is not hypothetical - an unrelated project's stale dev server was
 * holding the port this app wanted, and the sliding default meant opening the
 * expected URL showed a different product entirely.
 *
 * ARBITER_PORT overrides the public port for exactly that case, when the
 * squatter is something you would rather not kill.
 */
import { spawn } from "node:child_process";

const ENTRY_PORT = process.env["ARBITER_PORT"] ?? "5173";

/**
 * On Windows `npm` is `npm.cmd`, a batch file, and `spawn("npm")` cannot find it -
 * spawn does not consult PATHEXT, so the lookup fails with ENOENT before anything
 * starts. `npm run dev` died on the first server every time on that platform.
 *
 * `shell: true` rather than hardcoding "npm.cmd": Node 20.12.2 and 18.20.2 closed
 * CVE-2024-27980 by REFUSING to spawn a .cmd without a shell, so naming the file
 * directly fixes the ENOENT and then breaks again on any patched Node. Going through
 * the shell is the arrangement that works on both sides of that change.
 *
 * Every argument below is a literal in this file - no user input, no paths with
 * spaces - so shell interpolation has nothing to bite on here. If an argument ever
 * becomes dynamic, quote it.
 */
const USE_SHELL = process.platform === "win32";

const SERVERS = [
  {
    name: "api",
    args: ["run", "api"],
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
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], shell: USE_SHELL });
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
  console.log(`         http://localhost:${ENTRY_PORT}/deliberation/  the product`);
  console.log(`         http://localhost:${ENTRY_PORT}/api            API`);
  console.log("");
}, 2500);
