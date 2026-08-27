/**
 * D274 item 6 (ledger 3 SE40–SE42) — the two READ-ONLY Settings status sections
 * state facts this process already holds, and nothing else.
 *
 * The claim under test is not "the projection compiles". It is the one SE42's
 * banner makes to the operator — *read from the descriptors, not from a list
 * somebody kept up to date* — plus its host half: a host on that page is a host
 * a run would navigate to. So the pins here are LITERAL expectations against the
 * real registry and the real config chain, never a re-derivation of the
 * production expression (which would pass no matter what either side said).
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../src/base/workflow.js";
import { manualClock } from "../../../src/domain/clock.js";
import { resolveConfig } from "../../../src/domain/config/resolve.js";
import { listSystemEntryHosts, resolveSystemEntryUrl } from "../../../src/domain/config/instance.js";
import { SettingsFactsWireSchema } from "../../../src/domain/dashboard/settings.js";
import { BrowserSystemIdSchema, FingerprintSchema } from "../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import { buildSettingsFacts } from "../../../src/server/dashboard/queries/settings.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { FixtureCommit, FixtureStage } from "../architecture/helpers/descriptor-fixtures.js";

const CLOCK = manualClock(new Date("2026-08-26T00:00:00.000Z"));
const KUALI_PROD = "https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb";
const KUALI_TEST = "https://ucsd-sbx.kualibuild.com/build/space/5e47518b90adda9474c14adb";

function facts(env: NodeJS.ProcessEnv = {}) {
  return buildSettingsFacts({
    config: resolveConfig(env, {}, CLOCK),
    descriptors: [...WORKFLOW_DESCRIPTORS],
  });
}

/**
 * A graph whose transaction declares NO preview arm — the one dry-run arm no
 * registered workflow produces today, and therefore the one arm that would
 * otherwise be unreachable in this suite. A cell shape nothing can render is
 * indistinguishable from a cell shape that is broken.
 */
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

describe("settings facts — system hosts (SE40)", () => {
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
        resolveSystemEntryUrl(resolveConfig({}, {}, CLOCK), host.system, "prod", "settings-facts.test"),
        `production host for ${host.system} is not the host a run resolves`,
      );
    }
  });

  it("names no test host when the deployment provisions none", () => {
    assert.deepEqual(facts().systemHosts.filter(({ test }) => test !== undefined), []);
  });

  it("serves a DISTINCT configured test host", () => {
    const kuali = facts({ HRAUTO_KUALI_TEST_URL: KUALI_TEST }).systemHosts
      .find(({ system }) => system === "kuali");
    assert.deepEqual(kuali, { system: "kuali", production: KUALI_PROD, test: KUALI_TEST });
  });

  /**
   * The negative control, and the reason `listSystemEntryHosts` exists rather
   * than a second read of `config.urls`: `resolveSystemEntryUrl` REFUSES a test
   * instance whose URL is not distinct from production, so a page advertising
   * one would be promising a sandbox every run asking for it is refused from.
   */
  it("drops a test host configured identical to production, exactly as a run refuses it", () => {
    const config = resolveConfig({ HRAUTO_KUALI_TEST_URL: KUALI_PROD }, {}, CLOCK);
    assert.equal(
      listSystemEntryHosts(config).find(({ system }) => system === "kuali")?.test,
      undefined,
    );
    assert.throws(
      () => resolveSystemEntryUrl(config, "kuali", "test", "settings-facts.test"),
      /no distinct test URL is configured/,
    );
  });
});

describe("settings facts — workflow capabilities (SE41)", () => {
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
    // A read-only graph has no transaction node, so a "dry run" of it is
    // byte-for-byte an ordinary run — a refusal, never a trivial yes (D209).
    assert.deepEqual(postures.get("person-lookup"), {
      state: "unsupported",
      reason: "no-transaction-node",
    });
    assert.deepEqual(postures.get("separations-ucpath-termination"), {
      state: "supported",
      stopsAt: "clear-pending",
    });
    assert.deepEqual(postures.get("separations-kuali-finalization"), {
      state: "supported",
      stopsAt: "finalize-kuali",
    });
  });

  it("names the offending node when a transaction declares no preview arm", () => {
    const [row] = buildSettingsFacts({
      config: resolveConfig({}, {}, CLOCK),
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
    assert.deepEqual(editData.get("person-lookup"), { state: "declared", editableFields: 3 });
    assert.deepEqual(editData.get("separations-kuali-read"), { state: "read-only" });
    // `editData: true` is a DECLARATION that keeps the Data section visible with
    // no correctable path — not the same statement as never declaring one.
    const [declared] = buildSettingsFacts({
      config: resolveConfig({}, {}, CLOCK),
      descriptors: [UNSUPPORTED_DESCRIPTOR],
    }).workflowCapabilities;
    assert.deepEqual(declared?.editData, { state: "declared", editableFields: 0 });
    assert.equal(declared?.reviewPanel, true);
  });

  it("lists only the gates an OPERATOR resolves", () => {
    const gates = new Map(
      facts().workflowCapabilities.map(({ workflowId, operatorGates }) => [String(workflowId), operatorGates]),
    );
    assert.deepEqual(gates.get("separations-identity-check"), ["identity-approval"]);
    assert.deepEqual(gates.get("separations-kronos-timecard"), []);
    // The fixture's only gate is `resolvedBy: "external"` — another system's
    // clock, not operator work, so it is absent rather than listed as something
    // to go and press.
    const [external] = buildSettingsFacts({
      config: resolveConfig({}, {}, CLOCK),
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
    assert.equal(typed.get("separations-kuali-read"), false);
  });
});

describe("settings facts — the wire itself", () => {
  it("round-trips through JSON under its own strict schema", () => {
    const served = facts({ HRAUTO_KUALI_TEST_URL: KUALI_TEST });
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
