import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDashboardClient,DashboardClientError } from "../../../src/dashboard/client/index.js";
import { PreflightRerunCommandResultWireSchema } from "../../../src/models/preflight/preflight-contract.js";
import {
buildPreflightReport,
requiredPreflightChecks,
} from "../../../src/models/preflight/preflight.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const CLOCK = manualClock(new Date("2026-08-28T18:00:00.000Z"));
const CONFIG_FINGERPRINT = "a".repeat(64);
const COMMAND = {
  commandId: "00000000-0000-4000-8000-000000000001",
  requestedAt: "2026-08-28T18:00:00.000Z",
  requestedBy: "local-operator",
  source: "settings-surface",
  type: "rerun-preflight" as const,
  target: { expectedConfigFingerprint: CONFIG_FINGERPRINT },
};

const REPORT = buildPreflightReport({
  configFingerprint: CONFIG_FINGERPRINT,
  requestedCapabilities: ["dashboard.serve"],
  observations: requiredPreflightChecks(["dashboard.serve"]).map((check) => ({
    check,
    state: "healthy" as const,
    summary: `${check} healthy`,
  })),
  clock: CLOCK,
});

const RESULT = {
  state: "completed" as const,
  commandId: COMMAND.commandId,
  report: REPORT,
};

function clientFor(body: unknown) {
  return createDashboardClient({
    baseUrl: "http://bff.test",
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
  });
}

function assertRejectedByWireAndClient(body: unknown, expectedMessage: RegExp): Promise<void> {
  const parsed = PreflightRerunCommandResultWireSchema.safeParse(body);
  assert.equal(parsed.success, false);
  assert.ok(!parsed.success && expectedMessage.test(parsed.error.message));
  return assert.rejects(
    clientFor(body).rerunPreflight(COMMAND),
    (error: unknown) => error instanceof DashboardClientError
      && error.kind === "schema" && error.code === "PREFLIGHT_RERUN_UNAVAILABLE",
  );
}

describe("preflight rerun dashboard client", () => {
  it("accepts only the server's complete semantic report", async () => {
    const result = await clientFor(RESULT).rerunPreflight(COMMAND);
    assert.equal(result.commandId, RESULT.commandId);
    assert.deepEqual(result.report.results, REPORT.results);
  });

  it("rejects invented, missing, reordered, and wrong mandatory/authority reports before Settings can render them", async () => {
    const [first, second] = REPORT.results;
    assert.ok(first !== undefined && second !== undefined);
    if (first === undefined || second === undefined) return;

    await assertRejectedByWireAndClient({
      ...RESULT,
      report: {
        ...REPORT,
        results: [{ ...first, check: "invented.check" }, ...REPORT.results.slice(1)],
      },
    }, /unregistered preflight check invented\.check/);

    await assertRejectedByWireAndClient({
      ...RESULT,
      report: { ...REPORT, results: REPORT.results.slice(1) },
    }, /omits selected check/);

    await assertRejectedByWireAndClient({
      ...RESULT,
      report: { ...REPORT, results: [second, first, ...REPORT.results.slice(2)] },
    }, /check order expects/);

    await assertRejectedByWireAndClient({
      ...RESULT,
      report: {
        ...REPORT,
        results: REPORT.results.map((result, index) => index === 0
          ? {
            status: "warning",
            check: result.check,
            summary: "made optional",
            impact: "fabricated",
            remediation: "repair",
          }
          : result),
      },
    }, /blocking check runtime\.compatibility cannot be a warning/);

    await assertRejectedByWireAndClient({
      ...RESULT,
      report: {
        ...REPORT,
        results: REPORT.results.map((result, index) => index === 0
          ? {
            status: "fail",
            check: result.check,
            summary: "wrong authority",
            blocks: ["executor.run"],
            remediation: "repair",
          }
          : result),
      },
    }, /omitted blocked capability dashboard\.serve/);
  });
});

it("rejects another command or report identity before readback can certify readiness", async () => {
  for (const body of [
    { ...RESULT, commandId: "00000000-0000-4000-8000-000000000002" },
    { ...RESULT, report: { ...REPORT, configFingerprint: "f".repeat(64) } },
    { ...RESULT, report: { ...REPORT, descriptorFingerprint: "f".repeat(64) } },
  ]) await assert.rejects(clientFor(body).rerunPreflight(COMMAND), (error: unknown) => error instanceof DashboardClientError
    && error.code === "COMMAND_RESULT_IDENTITY_MISMATCH");
});
