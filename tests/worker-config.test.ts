import test from "node:test";
import assert from "node:assert/strict";
import { autoStartEnabled } from "../src/worker-config.js";

test("reads AUTO_START from GELD_CONFIG JSON", () => {
  assert.equal(autoStartEnabled({ GELD_CONFIG: JSON.stringify({ GELD_AUTO_START: "true" }) }), true);
  assert.equal(autoStartEnabled({ GELD_CONFIG: JSON.stringify({ GELD_AUTO_START: true }) }), true);
});

test("falls back to the top-level Worker variable when GELD_CONFIG omits AUTO_START", () => {
  assert.equal(autoStartEnabled({ GELD_CONFIG: JSON.stringify({ POSITION_SIZE_PCT: "24" }), GELD_AUTO_START: "on" }), true);
  assert.equal(autoStartEnabled({ GELD_AUTO_START: "1" }), true);
});

test("embedded GELD_CONFIG value takes precedence and false remains off", () => {
  assert.equal(autoStartEnabled({ GELD_CONFIG: JSON.stringify({ GELD_AUTO_START: "false" }), GELD_AUTO_START: "true" }), false);
  assert.equal(autoStartEnabled({}), false);
});
