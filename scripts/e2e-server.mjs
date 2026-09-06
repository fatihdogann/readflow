import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const dataDir = path.resolve(".readflow-e2e");
fs.rmSync(dataDir, { recursive: true, force: true });

const child = spawn(
  "pnpm",
  [
    "exec",
    "concurrently",
    "-k",
    "-n",
    "web,worker",
    "-c",
    "blue,magenta",
    "next start -p 3210",
    "tsx src/worker/index.ts",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      READFLOW_DATA_DIR: dataDir,
      READFLOW_AGENT_MODE: "mock",
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code) => process.exit(code ?? 0));
