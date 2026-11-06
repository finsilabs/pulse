import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("src", { recursive: true })
  .filter((p) => p.endsWith(".test.ts"))
  .map((p) => "src/" + p)
  .sort();
if (!files.length) throw Error("No test files found");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
