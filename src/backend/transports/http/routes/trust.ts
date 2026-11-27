import { z } from "zod";
import { ArtifactIdSchema, DiagnosticBundleIdSchema, RunIdSchema } from "../../../../rules/identity/ids.js";
import { SectionNameSchema } from "../../../runs/queries/run-read.js";
import { rawRouteQuery, RunSectionQuerySchema } from "./request-parameters.js";
import type { TrustRouteDeps } from "./trust-types.js";

import { readRunSectionBody } from "../../../runs/queries/run-detail.js";
import {
  readDiagnosticBundle,
  readDiagnosticBundleAttachment,
  prepareLiveDiagnosticArtifactLease,
} from "../../../runs/queries/diagnostic-bundle.js";
import {
  IndexedArtifactBytesMissingError,
} from "../../../runs/queries/artifact-bytes.js";

import { DiagnosticBundleBytesMissingError, SectionUnavailableError } from "../../../runs/commands/refusals.js";

import { verifiedByteResponse } from "./verified-byte-response.js";
import type { DashboardApp } from "./api-types.js";

const BundlePathSchema = z.strictObject({ bundleId: DiagnosticBundleIdSchema });
const BundleAttachmentPathSchema = BundlePathSchema.extend({ artifactId: ArtifactIdSchema });
const ArtifactPathSchema = z.strictObject({ artifactId: ArtifactIdSchema });
const SectionPathSchema = z.strictObject({ runId: RunIdSchema, section: SectionNameSchema });

export function registerTrustRoutes(app: DashboardApp, deps: TrustRouteDeps): void {
  // Failure responses are private evidence too. Install after the capture Host
  // gate so a phone request still receives the byte-identical unrouted refusal.
  app.use("/api/v1/diagnostic-bundles/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId/manifest", async (c) => {
    const { bundleId } = BundlePathSchema.parse(c.req.param());
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("diagnostic bundle readback is not available: no diagnostic bundle authority is composed");
    }
    const bundle = await readDiagnosticBundle(
      deps.diagnosticBundles,
      bundleId,
      undefined,
      c.req.raw.signal,
    );
    return new Response(bundle.manifest, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${bundle.wire.bundleId}.json"`,
        "cache-control": "no-store",
      },
    });
  });

  /** A screenshot resource stays bound to the exact inspected bundle, not only its global artifact id. */
  app.get("/api/v1/diagnostic-bundles/:bundleId/attachments/:artifactId", async (c) => {
    const { bundleId, artifactId } = BundleAttachmentPathSchema.parse(c.req.param());
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError(
        "diagnostic attachment readback is not available: no diagnostic attachment authority is composed",
      );
    }
    const attachment = await readDiagnosticBundleAttachment(
      deps.diagnosticBundles,
      bundleId,
      artifactId,
      c.req.raw.signal,
    );
    return verifiedByteResponse({
      lease: attachment.lease,
      method: c.req.method,
      range: c.req.header("range"),
      profile: "bundle",
    });
  });

  app.get("/artifacts/v1/:artifactId", async (c) => {
    const { artifactId } = ArtifactPathSchema.parse(c.req.param());
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError(
        "diagnostic artifact readback is not available: no diagnostic attachment authority is composed",
      );
    }
    let artifact: Awaited<ReturnType<typeof prepareLiveDiagnosticArtifactLease>>;
    try {
      artifact = await prepareLiveDiagnosticArtifactLease(
        {
          runReader: deps.diagnosticBundles.runReader,
          authority: deps.diagnosticBundles.authority,
          artifactReader: deps.diagnosticBundles.artifactReader,
        },
        artifactId,
        c.req.raw.signal,
      );
    } catch (error: unknown) {
      if (error instanceof IndexedArtifactBytesMissingError) {
        throw new DiagnosticBundleBytesMissingError(error.message, { cause: error });
      }
      throw error;
    }
    return verifiedByteResponse({
      lease: artifact.lease,
      method: c.req.method,
      range: c.req.header("range"),
      profile: "generic",
    });
  });

  app.get("/api/v1/runs/:runId/:section", async (c) => {
    const { runId, section } = SectionPathSchema.parse(c.req.param());
    const { cursor } = RunSectionQuerySchema.parse(rawRouteQuery(c.req.url));
    return c.body(await readRunSectionBody(
      deps.runDetail,
      runId,
      section,
      cursor,
      c.req.raw.signal,
      c.req.header("x-relay-tab"),
    ), 200, { "Content-Type": "application/json" });
  });
}
