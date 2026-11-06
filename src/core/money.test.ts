import test from "node:test";
import assert from "node:assert/strict";
import { money } from "./snapshot.js";

test("monetary rounding preserves ISO subdivisions independently of Meta budget offsets", () => {
  assert.equal(money(50.25, "PKR"), 50.25);
  assert.equal(money(50.125, "BHD"), 50.125);
  assert.equal(money(50.125, "JOD"), 50.125);
  assert.equal(money(50.25, "TWD"), 50.25);
  assert.equal(money(50.25, "CRC"), 50.25);
  assert.equal(money(50.25, "JPY"), 50);
});
