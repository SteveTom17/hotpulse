import { spawn } from "node:child_process";
import { resolve } from "node:path";

const command = process.argv[2];
const allowed = new Set(["dev", "build", "start"]);

if (!allowed.has(command)) {
  console.error("Usage: node scripts/vinext.mjs <dev|build|start>");
  process.exit(1);
}

const cli = resolve("node_modules/vinext/dist/cli.js");
const child = spawn(process.execPath, [cli, command], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH:
      process.env.WRANGLER_LOG_PATH ?? resolve(".wrangler/wrangler.log"),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
