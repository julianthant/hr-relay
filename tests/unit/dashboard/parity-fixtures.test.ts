/**
 * The parity fixture corpus is only trustworthy if it stays inside the strict
 * wire contracts AND internally consistent (D81: counts can never disagree
 * with the surfaces they summarize). Construction already schema-parses every
 * value; this suite pins the cross-value invariants and proves the fixture
 * BFF actually serves the corpus over real HTTP.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DashboardDayWireSchema } from "../../../src/domain/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema } from "../../../src/domain/dashboard/subscription.js";
import { FrontendBootstrapWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import {
  fixtureHealthEnvelope,
  fixtureHelloEnvelope,
  fixtureSnapshotEnvelope,
  startFixtureServer,
} from "../../parity/helpers/fixture-bff.js";
import {
  FIXTURE_DAY_WIRE,
  FIXTURE_IDS,
  FIXTURE_RUN_DETAILS,
  FIXTURE_SECTIONS,
} from "../../parity/helpers/fixture-day.js";

const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("parity fixture corpus", () => {
  it("keeps D81 count semantics: statusCounts recount exactly from non-member surfaces", () => {
    const countable = FIXTURE_DAY_WIRE.queueSurfaces.filter((surface) => surface.surfaceKind !== "member");
    const recount = new Map<string, number>();
    for (const surface of countable) {
      recount.set(surface.status, (recount.get(surface.status) ?? 0) + 1);
    }
    const expected = [...recount.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => ({ status, count }));
    expect(FIXTURE_DAY_WIRE.statusCounts).toEqual(expected);
    expect(FIXTURE_DAY_WIRE.workflowCounts).toEqual([
      { workflowId: "person-lookup", count: countable.length },
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
    // API-only probe: this server never renders the app, so it declares its
    // bundle unverified rather than demanding a working-tree build. The parity
    // lane itself may never take this branch — parity-reference-authority
    // proves no spec does.
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
