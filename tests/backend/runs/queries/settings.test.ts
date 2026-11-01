import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { buildSettingsFacts } from "../../../../src/backend/runs/queries/settings.js";
import { resolveSystemEntryUrl } from "../../../../src/models/config/instance.js";
import { SettingsFactsWireSchema } from "../../../../src/models/dashboard/settings.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { BrowserSystemIdSchema,FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { FixtureCommit,FixtureStage } from "../../../support/fixtures/descriptor-fixtures.js";

const CLOCK = manualClock(new Date("2026-08-26T00:00:00.000Z"));
const KUALI_PROD = "https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb";
const KUALI_TEST = "https://ucsd-sbx.kualibuild.com/build/space/5e47518b90adda9474c14adb";

function facts(settings: unknown = {}) {
  return buildSettingsFacts({
    config: resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK).config,
    descriptors: [...WORKFLOW_DESCRIPTORS],
  });
}


const UnsupportedInput = z.strictObject({ eid: z.literal("10873698") });
const UNSUPPORTED_DESCRIPTOR = defineWorkflowDescriptor({
  id: "unpreviewable-fixture",
  version: 1,
  contractFingerprint: FingerprintSchema.parse("a".repeat(64)),
  code: "up",
  label: "Unpreviewable fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: defineCanonicalInput(UnsupportedInput, UnsupportedInput, [{ eid: "10873698" }]),
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  capabilities: { review: true, editData: true },
  identity: { matchKey: (input) => `eid:${input.eid}` },
  presentation: { title: (input) => `Unpreviewable ${input.eid}` },
  scenarios: ["unpreviewable-fixture/happy"],
  flow: flow(UnsupportedInput)
    .gate("system-wait", {
      dependsOn: [],
      label: "System wait",
      resolvedBy: "external",
      subscribes: {
        kind: "external",
        sourceId: "settings-facts-fixture",
        event: z.strictObject({ cleared: z.boolean() }),
        correlationKey: "eid",
      },
      resolve: (event: { readonly cleared: boolean }) => ({ cleared: event.cleared }),
      result: z.strictObject({ cleared: z.boolean() }),
    })
    .transaction("write-anyway", {
      dependsOn: ["system-wait"],
      prepare: { uses: FixtureStage, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: FixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "unsupported",
      probePolicy: "always",
      probeToFenceMaxMs: 30_000,
    })
    .build({
      schema: z.strictObject({ transactionId: z.string().min(1) }),
      dependsOn: ["write-anyway"],
      derive: ({ outputs }) => ({ transactionId: outputs["write-anyway"].output.transactionId }),
    }),
});

describe("settings facts — system hosts", () => {
  it("lists every browser system exactly once, in the config's own order", () => {
    assert.deepEqual(
      facts().systemHosts.map(({ system }) => system),
      [...BrowserSystemIdSchema.options],
    );
  });

  it("serves the production host a run would actually navigate to", () => {
    for (const host of facts().systemHosts) {
      assert.equal(
        host.production,
        resolveSystemEntryUrl(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config, host.system, "prod", "settings-facts.test"),
        `production host for ${host.system} is not the host a run resolves`,
      );
    }
  });

  it("names no test host when the deployment provisions none", () => {
    assert.deepEqual(
      facts().systemHosts.filter(({ test }) => test.state !== "not-provisioned"),
      [],
    );
  });

  it("does not offer an old configured test host for new runs", () => {
    const kuali = facts({ urls: { kuali: { test: { entry: KUALI_TEST } } } }).systemHosts
      .find(({ system }) => system === "kuali");
    assert.deepEqual(kuali, {
      system: "kuali",
      production: KUALI_PROD,
      test: { state: "not-provisioned" },
    });
  });
});

describe("settings facts — workflow capabilities", () => {
  it("carries one row per registered workflow, and no label (the bootstrap owns that)", () => {
    const rows = facts().workflowCapabilities;
    assert.deepEqual(
      rows.map(({ workflowId }) => workflowId),
      WORKFLOW_DESCRIPTORS.map(({ id }) => id),
    );
    for (const row of rows) assert.equal("label" in row, false);
  });

  it("states where a dry run stops, per the registry's own graphs", () => {
    const postures = new Map(
      facts().workflowCapabilities.map(({ workflowId, dryRun }) => [String(workflowId), dryRun]),
    );

    assert.deepEqual(postures.get("person-lookup"), {
      state: "unsupported",
      reason: "no-transaction-node",
    });
    assert.deepEqual(postures.get("separations"), {
      state: "supported",
      firstTransactionNodeId: "clear-pending",
    });
  });

  it("names the offending node when a transaction declares no preview arm", () => {
    const [row] = buildSettingsFacts({
      config: resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config,
      descriptors: [UNSUPPORTED_DESCRIPTOR],
    }).workflowCapabilities;
    assert.deepEqual(row?.dryRun, {
      state: "unsupported",
      reason: "node-declares-unsupported",
      nodeId: "write-anyway",
    });
  });

  it("counts the editable Edit Data paths a descriptor declares, and keeps zero distinct from read-only", () => {
    const editData = new Map(
      facts().workflowCapabilities.map(({ workflowId, editData: posture }) => [String(workflowId), posture]),
    );
    assert.deepEqual(editData.get("person-lookup"), { state: "declared", editableFields: 2 });
    assert.deepEqual(editData.get("separations"), { state: "read-only" });
    // `editData: true` is a DECLARATION that keeps the Data section visible with
    // no correctable path — not the same statement as never declaring one.
    const [declared] = buildSettingsFacts({
      config: resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config,
      descriptors: [UNSUPPORTED_DESCRIPTOR],
    }).workflowCapabilities;
    assert.deepEqual(declared?.editData, { state: "declared", editableFields: 0 });
    assert.equal(declared?.reviewPanel, true);
  });


  it("reports reviewPanel false for a real registered workflow that declares no Review panel", () => {
    const rows = new Map(
      facts().workflowCapabilities.map(({ workflowId, reviewPanel }) => [String(workflowId), reviewPanel]),
    );
    assert.equal(rows.get("person-lookup"), false);
  });

  it("lists only the gates an OPERATOR resolves", () => {
    const gates = new Map(
      facts().workflowCapabilities.map(({ workflowId, operatorGates }) => [String(workflowId), operatorGates]),
    );
    assert.deepEqual(gates.get("separations"), ["identity-approval"]);
    assert.deepEqual(gates.get("person-lookup"), []);

    const [external] = buildSettingsFacts({
      config: resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config,
      descriptors: [UNSUPPORTED_DESCRIPTOR],
    }).workflowCapabilities;
    assert.deepEqual(external?.operatorGates, []);
  });


  it("lists the browser systems the graph drives, sorted", () => {
    const systems = new Map(
      facts().workflowCapabilities.map(({ workflowId, browserSystems }) => [String(workflowId), browserSystems]),
    );
    assert.deepEqual(systems.get("person-lookup"), ["crm", "ucpath"]);
    assert.deepEqual(systems.get("separations"), ["kuali", "new-kronos", "ucpath"]);
  });

  it("reports the typed-start door as declared, per descriptor", () => {
    const typed = new Map(
      facts().workflowCapabilities.map(({ workflowId, typedStart }) => [String(workflowId), typedStart]),
    );
    assert.equal(typed.get("person-lookup"), true);
    assert.equal(typed.get("separations"), true);
  });
});

describe("settings facts — the wire itself", () => {
  it("round-trips through JSON under its own strict schema", () => {
    const served = facts({ urls: { kuali: { test: { entry: KUALI_TEST } } } });
    const parsed = SettingsFactsWireSchema.parse(JSON.parse(JSON.stringify(served)));
    assert.deepEqual(parsed, served);
  });

  it("refuses a document that names one system or one workflow twice", () => {
    const served = facts();
    const [firstHost] = served.systemHosts;
    const [firstRow] = served.workflowCapabilities;
    assert.throws(
      () => SettingsFactsWireSchema.parse({ ...served, systemHosts: [firstHost, firstHost] }),
      /systemHosts identities must be unique/,
    );
    assert.throws(
      () => SettingsFactsWireSchema.parse({ ...served, workflowCapabilities: [firstRow, firstRow] }),
      /workflowCapabilities identities must be unique/,
    );
  });

  it("refuses an unknown field — the vocabulary grows by wire change, never by drift", () => {
    assert.throws(() => SettingsFactsWireSchema.parse({ ...facts(), roster: [] }));
  });
});
