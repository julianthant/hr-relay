import { Hono } from "hono";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { ItemAttemptHistoryResponseSchema } from "../../../../../../src/models/dashboard/item-attempt-history.js";
import { restrictedJpegDiagnosticFixture } from "../../../../../support/fixtures/dashboard/diagnostic-jpeg-fixture.js";
import { FIXTURE_RUN_DETAILS,FIXTURE_SECTIONS } from "../../../../../support/fixtures/dashboard/fixture-detail.js";
import {
FIXTURE_RUN_CAPTURE_DETAILS,FIXTURE_RUN_CAPTURE_RECEIPTS,
FIXTURE_RUN_CAPTURE_REFS,
FIXTURE_RUN_CAPTURE_SECTIONS,
runCaptureFixtureBytes
} from "../../../../../support/fixtures/dashboard/fixture-run-captures.js";
import { wireError } from "../../../../../support/fixtures/dashboard/fixture-wire-error.js";
import { FIXTURE_DAY, uuidOf } from "../../../../../support/fixtures/dashboard/fixture-identity.js";
export function registerFixtureDetailRoutes({ app, runCaptureEvidence, diagnostic }: { app: Hono; runCaptureEvidence: boolean; diagnostic: Omit<ReturnType<typeof restrictedJpegDiagnosticFixture>, "screenshotBytes"> & { screenshotBytes: Uint8Array } }): void {

  app.get("/api/v1/runs/:runId/attempt-history", (c) => {
    const runId = c.req.param("runId");
    const detail = FIXTURE_RUN_DETAILS[runId];
    if (detail === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture attempt history for ${runId}`), 404);
    }
    const seed = Number.parseInt(runId.slice(-12), 10);
    const itemId = uuidOf(seed + 5000);
    const attempt = detail.header.attempt;
    const rowRevision = detail.rowRevision;
    const workflowId = detail.header.workflowId;
    const entry = {
      disposition: "live" as const,
      runId,
      workflowId,
      itemId,
      attempt,
      rowRevision,
      partitionDay: FIXTURE_DAY,
    };
    const response = ItemAttemptHistoryResponseSchema.parse({
      schemaVersion: 1,
      state: "available",
      selected: { state: "present", disposition: "live", runId, workflowId, itemId, attempt, rowRevision },
      item: { workflowId, itemId },
      page: { limit: 50, offset: 0, totalEntries: 1, entries: [entry], nextCursor: null },
    });
    return c.json(response);
  });


  app.get("/api/v1/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const detail = runCaptureEvidence && FIXTURE_RUN_CAPTURE_DETAILS[runId] !== undefined
      ? FIXTURE_RUN_CAPTURE_DETAILS[runId] : FIXTURE_RUN_DETAILS[runId];
    if (detail === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture run detail for ${c.req.param("runId")}`), 404);
    }
    return c.json(detail as unknown);
  });


  app.get("/api/v1/runs/:runId/:section", (c) => {
    if (runCaptureEvidence && c.req.param("section") === "receipt") {
      const receipt = FIXTURE_RUN_CAPTURE_RECEIPTS[c.req.param("runId")];
      if (receipt !== undefined) return c.json(receipt);
    }
    if (runCaptureEvidence && c.req.param("section") === "captures") {
      const captures = FIXTURE_RUN_CAPTURE_SECTIONS[c.req.param("runId")];
      if (captures !== undefined) return c.json(captures);
    }
    const sections = FIXTURE_SECTIONS[c.req.param("runId")];
    const section = sections?.[c.req.param("section")];
    if (section === undefined) {
      return c.json(
        wireError("SECTION_UNAVAILABLE", `no fixture ${c.req.param("section")} section for ${c.req.param("runId")}`),
        404,
      );
    }
    return c.json(section as unknown);
  });



  app.get("/api/v1/diagnostic-bundles/:bundleId", (c) => {
    if (c.req.param("bundleId") !== diagnostic.bundle.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    return c.json(diagnostic.bundle as unknown);
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId/manifest", (c) => {
    if (c.req.param("bundleId") !== diagnostic.bundle.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    return new Response(canonicalJsonStringify(diagnostic.manifest), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${diagnostic.bundle.bundleId}.json"`,
      },
    });
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId/attachments/:artifactId", (c) => {
    if (c.req.param("bundleId") !== diagnostic.bundle.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    const screenshot = diagnostic.bundle.contents.find((content) => content.kind === "screenshot");
    if (screenshot === undefined || c.req.param("artifactId") !== screenshot.artifactId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic attachment ${c.req.param("artifactId")}`), 404);
    }
    const responseBytes = Uint8Array.from(diagnostic.screenshotBytes);
    return new Response(responseBytes.buffer, {
      status: 200,
      headers: {
        "content-type": screenshot.mediaType,
        "content-length": String(diagnostic.screenshotBytes.byteLength),
        "cache-control": "no-store",
      },
    });
  });

  app.get("/artifacts/v1/:artifactId", (c) => {
    const artifactId = c.req.param("artifactId");
    const ref = FIXTURE_RUN_CAPTURE_REFS[artifactId];
    const bytes = runCaptureEvidence ? runCaptureFixtureBytes(artifactId) : undefined;
    if (ref === undefined || bytes === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no generic fixture artifact ${artifactId}`), 404);
    }
    return new Response(bytes, { status: 200, headers: {
      "content-type": ref.mediaType, "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="capture-${artifactId}"`,
      "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
  });
}
