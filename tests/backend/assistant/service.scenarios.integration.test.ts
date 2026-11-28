import assert from "node:assert/strict";
import { it } from "vitest";
import { assertScenarioBudget, runAssistantScenario } from "../../support/helpers/assistant-scenario.js";
import { personLookup, scenarios } from "./scenarios/conversations.js";
import { fullAccess } from "./scenarios/full-access.js";

it.each([...scenarios, fullAccess])("$name", async scenario => {
  const measured = await runAssistantScenario(scenario);
  console.info(`assistant-scenario | ${scenario.name} | ${measured.largestRequest} | ${measured.total}`);
  assertScenarioBudget(scenario.name, scenario.budget, measured);
});

it("fails either budget below the measured conversation and names its biggest contributors", async () => {
  const measured = await runAssistantScenario(personLookup);
  for (const limit of ["largestRequest", "total"] as const) {
    assert.throws(() => assertScenarioBudget(personLookup.name, { ...measured, [limit]: measured[limit] - 1 }, measured), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`largest request ${measured.largestRequest}`));
      assert.ok(error.message.includes(`scenario total ${measured.total}`));
      assert.ok(error.message.includes(`exceeded ${limit}`));
      assert.match(error.message, /tool namespace \(\d+\), fixed prompt \(\d+\), tool result relay\.read_person \(call-1\) \(\d+\)/u);
      return true;
    });
  }
});
