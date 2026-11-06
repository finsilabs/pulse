import { readdirSync, readFileSync } from "node:fs";
// A secondary spellcheck. Behavioral adapter tests are the actual read-only proof.
const files = readdirSync("src/adapters").filter(
  (x) => x.endsWith(".ts") && !x.endsWith(".test.ts"),
);
const forbidden = [
  /googleAds:mutate/i,
  /\/mutate\b/i,
  /ads_management/,
  /\/(?:pause|delete|update_budget)\b/,
];
for (const f of files)
  for (const rule of forbidden)
    if (rule.test(readFileSync("src/adapters/" + f, "utf8")))
      throw Error("Forbidden platform capability in " + f);
console.log(
  "Read-only surface guard passed; adapter contract tests verify requests.",
);
