import { fixtureIntakePresentation } from "../../../parity/helpers/fixture-intake-routes.js";
import { fixturePreflightReport } from "../../../parity/helpers/fixture-preflight-routes.js";
import { DEFAULT_DASHBOARD_PROFILE } from "../../../parity/helpers/fixture-profile.js";

import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll,describe,expect,it } from "vitest";
import { FrontendBootstrapWireSchema,WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../../../src/models/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema } from "../../../../src/models/dashboard/subscription.js";
import {
FIXTURE_DAY_WIRE,
FIXTURE_IDS,
FIXTURE_RUN_DETAILS,
FIXTURE_SECTIONS,
} from "../../../parity/helpers/fixture-day.js";
import {
FIXTURE_INTAKE_MAPPING,
FIXTURE_INTAKE_VALIDATED,
} from "../../fixtures/dashboard/fixture-intake.js";
import {
fixtureHealthEnvelope,
fixtureHelloEnvelope,
fixtureSnapshotEnvelope,
startFixtureServer,
} from "./fixture-bff.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});


describe("intake fixture corpus", () => {
  it("keeps suggestions out of bindings, which is the whole §2.5 invariant", () => {

    expect(FIXTURE_INTAKE_MAPPING.bindings.map((binding) => binding.targetFieldId)).toEqual(["emplId"]);
    const proposed = FIXTURE_INTAKE_MAPPING.suggestions.map((suggestion) => suggestion.targetFieldId);
    expect(proposed).toContain("name");
    for (const suggestion of FIXTURE_INTAKE_MAPPING.suggestions) {
      expect(Object.keys(suggestion).sort()).toEqual(
        ["ambiguous", "score", "sourceColumnId", "targetFieldId", "why"],
      );
    }
  });

  it("covers every source row exactly once across valid, rejected and excluded", () => {
    const validation = FIXTURE_INTAKE_VALIDATED.validation;
    expect(validation.state).toBe("validated");
    if (validation.state !== "validated") return;
    const rejectedRows = new Set(validation.rejected.map((reject) => reject.sourceRow));
    expect(validation.validRows + rejectedRows.size + validation.excluded.length)
      .toBe(FIXTURE_INTAKE_VALIDATED.rowCount);
  });

  it("exercises the rejection kinds an operator actually has to decide about", () => {
    const validation = FIXTURE_INTAKE_VALIDATED.validation;
    if (validation.state !== "validated") throw new Error("the validated fixture is not validated");
    const codes = new Set(validation.rejected.map((reject) => reject.code));

    expect(codes).toContain("cell-coercion");
    expect(codes).toContain("duplicate-identity");
    expect(codes).toContain("cross-field");
  });

  it("binds preflight reports to served authority rather than presentation identity", () => {
    const profile = { ...DEFAULT_DASHBOARD_PROFILE, descriptorHash: "d".repeat(64) };
    expect(fixturePreflightReport(profile).descriptorFingerprint).toBe(profile.bootstrap.descriptorHash);
    const workflow = WorkflowBootstrapPrimitiveSchema.parse(profile.bootstrap.workflows[0]);
    expect(fixturePreflightReport(profile, workflow.id).descriptorFingerprint).toBe(workflow.descriptorFingerprint);
  });
  it("retains the complete rejected cell in local evidence", () => {
    const validation = FIXTURE_INTAKE_VALIDATED.validation;
    if (validation.state !== "validated") throw new Error("the validated fixture is not validated");
    const coercion = validation.rejected.find((reject) => reject.kind === "cell-coercion");
    expect(coercion).toBeDefined();
    expect(coercion?.kind === "cell-coercion" ? coercion.raw : undefined).toEqual({
      state: "allowed", classification: "direct-identifier", transform: "allow", value: "10-4567",
    });
    const presentation = fixtureIntakePresentation(FIXTURE_INTAKE_VALIDATED).validation;
    if (presentation.state !== "validated") throw new Error("the presentation fixture is not validated");
    const displayed = presentation.rejected.find(reject => reject.kind === "cell-coercion");
    expect(displayed?.kind === "cell-coercion" ? displayed.raw : undefined).toEqual({
      state: "transformed", classification: "direct-identifier", transform: "last4", value: "4567",
    });
    expect(coercion?.kind === "cell-coercion" ? coercion.raw : undefined).toEqual({
      state: "allowed", classification: "direct-identifier", transform: "allow", value: "10-4567",
    });
  });
});

describe("parity fixture corpus", () => {
  it("keeps count semantics: statusCounts recount exactly from non-member surfaces", () => {
    const countable = FIXTURE_DAY_WIRE.queueSurfaces.filter((surface) => surface.surfaceKind !== "member");
    const recount = new Map<string, number>();
    for (const surface of countable) {
      recount.set(surface.status, (recount.get(surface.status) ?? 0) + 1);
    }
    const expected = [...recount.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => ({ status, count }));
    expect(FIXTURE_DAY_WIRE.statusCounts).toEqual(expected);
    // The fixture serves ONE workflow, so the per-workflow status dimension
    // must be the day's own — the agreement the single projector fold gives.
    expect(FIXTURE_DAY_WIRE.workflowCounts).toEqual([
      { workflowId: "person-lookup", count: countable.length, statusCounts: expected },
    ]);
    expect(
      FIXTURE_DAY_WIRE.monthCounts.find(({ day }) => day === FIXTURE_DAY_WIRE.day)?.count,
    ).toBe(countable.length);
    // The full eight-status vocabulary is present among countable surfaces.
    expect([...recount.keys()].sort()).toEqual([
      "awaiting-approval", "blocked", "cancelled", "done", "failed", "partial", "queued", "running",
    ]);
  });

  it("serves a detail wire and a logs section for every named fixture run", () => {
    for (const [role, runId] of Object.entries(FIXTURE_IDS)) {
      if (role === "conflictRun" || role === "rejectedRun" || role === "failureId") continue;
      const isDetailRole = runId in FIXTURE_RUN_DETAILS;
      const isRowOnlyRole = FIXTURE_DAY_WIRE.queueSurfaces.some((surface) => surface.runId === runId);
      expect(isDetailRole || isRowOnlyRole, `${role} must name a fixture run`).toBe(true);
      if (isDetailRole) {
        const sections = FIXTURE_SECTIONS[runId];
        expect(sections?.logs, `${role} must serve a logs section`).toBeDefined();
        expect(sections?.receipt, `${role} must serve the receipt placeholder state`).toBeDefined();
      }
    }
  });

  it("conserves every operation rollup", () => {
    const byId = new Map(FIXTURE_DAY_WIRE.queueSurfaces.map((surface) => [surface.runId, surface]));
    const operations = FIXTURE_DAY_WIRE.queueSurfaces.filter((surface) => surface.surfaceKind === "operation");
    expect(operations.map(({ memberRunIds }) => memberRunIds.length).sort((a, b) => a - b)).toEqual([1, 3, 4, 12, 13]);
    for (const operation of operations) {
      expect(operation.memberRollup.total).toBe(operation.memberRunIds.length);
      expect(operation.memberRollup.failed).toBeLessThanOrEqual(operation.memberRollup.terminal);
      expect(operation.memberRollup.terminal).toBeLessThanOrEqual(operation.memberRollup.total);
      for (const memberId of operation.memberRunIds) {
        const member = byId.get(memberId);
        expect(member?.surfaceKind).toBe("member");
        expect(member?.lineage).toEqual({ state: "child", parentRunId: operation.runId });
      }
    }
  });

  it("emits only schema-legal SSE envelopes", () => {
    for (const envelope of [fixtureHelloEnvelope(), fixtureSnapshotEnvelope(), fixtureHealthEnvelope()]) {
      expect(() => DashboardStreamEnvelopeSchema.parse(envelope)).not.toThrow();
    }
  });

  it("serves the corpus over real HTTP from an ephemeral port", async () => {
    const distDir = mkdtempSync(join(tmpdir(), "hrauto-parity-dist-"));
    writeFileSync(join(distDir, "index.html"), "<!doctype html><title>probe</title>");

    const server = await startFixtureServer({
      distDir,
      bundle: { proof: "unverified", reason: "API/SSE route probe; the served dist is a one-file stub, never rendered" },
    });
    cleanups.push(async () => {
      await server.close();
      rmSync(distDir, { recursive: true, force: true });
    });

    const bootstrap = await fetch(`${server.baseUrl}/api/v1/bootstrap`);
    expect(bootstrap.status).toBe(200);
    const bootstrapBody: unknown = await bootstrap.json();
    expect(() => FrontendBootstrapWireSchema.parse(bootstrapBody)).not.toThrow();

    const day = await fetch(`${server.baseUrl}/api/v1/dashboard?day=2026-08-03`);
    const dayBody: unknown = await day.json();
    expect(() => DashboardDayWireSchema.parse(dayBody)).not.toThrow();

    const missingDay = await fetch(`${server.baseUrl}/api/v1/dashboard?day=2026-01-01`);
    expect(missingDay.status).toBe(404);

    const page = await fetch(`${server.baseUrl}/`);
    expect(await page.text()).toContain("probe");
  });
});
