import { mkdir, writeFile } from "node:fs/promises";
import { buildPlay } from "../dist/core/play.js";
import { defaultConfig } from "../dist/core/config.js";
import { syntheticSnapshot, scenarios } from "../dist/fixtures/generate.js";
const now = new Date("2026-10-02T12:00:00Z");
await mkdir("examples", { recursive: true });
await mkdir("fixtures/accounts", { recursive: true });
for (const scenario of scenarios) {
  const snapshot = syntheticSnapshot(scenario, now),
    play = buildPlay(snapshot, defaultConfig(), {}, now);
  play.synthetic = true;
  await writeFile(
    "fixtures/accounts/" + scenario + ".json",
    JSON.stringify(snapshot, null, 2) + "\n",
  );
  await writeFile(
    "examples/" + scenario + ".json",
    JSON.stringify(play, null, 2) + "\n",
  );
}
console.log("Generated five explicitly synthetic scenarios and plays.");
