import assert from "node:assert/strict";
import { test } from "node:test";

import { SCENARIOS, nextScenarioSelection, scenarioLabel } from "./scenario.ts";

test("hydrates the selector from the backend scenario (missing-reading round trip)", () => {
  assert.equal(nextScenarioSelection("missing-reading", null), "missing-reading");
  assert.equal(scenarioLabel("missing-reading"), "Missing meter — fail closed");
});

test("never falls back to hidden-leak while replay state is still loading", () => {
  assert.equal(nextScenarioSelection(null, null), null);
  assert.equal(nextScenarioSelection(undefined, null), null);
});

test("a deliberate pending choice wins over the server value until applied", () => {
  assert.equal(nextScenarioSelection("missing-reading", "counter-reset"), "counter-reset");
});

test("after reset clears the pending choice the selector reflects the server again", () => {
  assert.equal(nextScenarioSelection("counter-reset", null), "counter-reset");
  assert.equal(nextScenarioSelection("repair", null), "repair");
});

test("every backend scenario id maps to exactly one UI label", () => {
  const ids = SCENARIOS.map(([id]) => id);
  assert.deepEqual([...ids], ["normal", "hidden-leak", "missing-reading", "counter-reset", "repair", "failed-repair"]);
  for (const [id, label] of SCENARIOS) {
    assert.equal(scenarioLabel(id), label);
  }
  assert.equal(scenarioLabel("not-a-scenario"), "Unknown scenario");
});
