import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, it } from "vitest";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const { roots, openDatabases, createHarness } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("F refuses resolution capability before journaling or changing failure/run authority", async () => {
  const h=await createHarness(undefined, { failureResolution: { capability: () => ({ state: "unavailable", reason: "resolution-not-implemented" }), execute: () => { throw new Error("unavailable executor reached"); } } });const commandId=randomUUID();const generation=h.database.getMeta().authorityGeneration;
  const result=h.kernel.execute({commandId,requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",reason:"Synthetic annotation capability probe",family:"failure-resolution",type:"annotate-failure",target:{runId:randomUUID(),failureId:randomUUID(),expectedVersion:1},payload:{action:"resolve",note:"Synthetic follow-up"}});
  assert.deepEqual(result,{state:"rejected",commandId,code:"capability-unavailable",message:"Failure resolution is not available in this build."});
  assert.equal(h.database.authority.commands.get(commandId),undefined);
  assert.equal(h.database.authority.commandAudits.findByCommand(commandId),undefined);
  assert.equal(h.database.getMeta().authorityGeneration,generation);
});
