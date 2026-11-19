import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { z } from "zod";
import { controlUpgradeReceiptSchema, controlUpgradeStep, type ControlUpgradeEvent, type ControlUpgradePhase } from "../../../../src/backend/storage/admission/installation.js";

it("machine-control upgrade: each replayed step runs, is already passed, or is refused in every phase", () => {
  const events: readonly ControlUpgradeEvent[] = ["plan-browsers", "stage-browsers", "publish", "publish-credentials", "finish"];
  const expected: Record<ControlUpgradePhase, Record<ControlUpgradeEvent, string>> = {
    preparing: { "plan-browsers": "run", "stage-browsers": "run", publish: "refused", "publish-credentials": "refused", finish: "refused" },
    "backing-up": { "plan-browsers": "passed", "stage-browsers": "passed", publish: "run", "publish-credentials": "refused", finish: "refused" },
    publishing: { "plan-browsers": "passed", "stage-browsers": "passed", publish: "run", "publish-credentials": "run", finish: "run" },
  };
  for (const [phase, row] of Object.entries(expected) as [ControlUpgradePhase, Record<ControlUpgradeEvent, string>][]) {
    for (const event of events) assert.equal(controlUpgradeStep(phase, event), row[event], `${phase} + ${event}`);
  }
});

it("machine-control upgrade: a publishing receipt requires every person's verified backup; backing up does not", () => {
  const schema = controlUpgradeReceiptSchema(z.unknown());
  const backups = [{ profileId: randomUUID(), directory: `${randomUUID()}.${randomUUID()}.authority` }];
  const verifiedIssue = (phase: ControlUpgradePhase) => {
    const result = schema.safeParse({ phase, backups });
    assert.equal(result.success, false);
    return result.error?.issues.some(issue => issue.path.join(".") === "backups.0.verifiedBackup") ?? false;
  };
  assert.equal(verifiedIssue("backing-up"), false);
  assert.equal(verifiedIssue("publishing"), true);
});
