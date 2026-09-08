

import { readRunSection } from "../queries/run-detail.js";
import {
  readDiagnosticBundle,
  readDiagnosticBundleAttachment,
  prepareLiveDiagnosticArtifactLease,
} from "../queries/diagnostic-bundle.js";
import {
  IndexedArtifactBytesMissingError,
} from "../queries/artifact-bytes.js";


import { DiagnosticBundleBytesMissingError, SectionUnavailableError } from "../../failures.js";


import { verifiedByteResponse } from "./verified-byte-response.js";
import type { DashboardApp, DashboardAppDeps } from "./api-types.js";

export function registerTrustRoutes(app: DashboardApp, deps: DashboardAppDeps): void {
  // Failure responses are private evidence too. Install after the capture Host
  // gate so a phone request still receives the byte-identical unrouted refusal.
  app.use("/api/v1/diagnostic-bundles/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId", async (c) => {
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("diagnostic bundle readback is not available: no diagnostic bundle authority is composed");
    }
    const bundle = await readDiagnosticBundle(
      deps.diagnosticBundles,
      c.req.param("bundleId"),
      undefined,
      c.req.raw.signal,
    );
    return c.json(bundle.wire);
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId/manifest", async (c) => {
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("diagnostic bundle readback is not available: no diagnostic bundle authority is composed");
    }
    const bundle = await readDiagnosticBundle(
      deps.diagnosticBundles,
      c.req.param("bundleId"),
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
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError(
        "diagnostic attachment readback is not available: no diagnostic attachment authority is composed",
      );
    }
    const attachment = await readDiagnosticBundleAttachment(
      deps.diagnosticBundles,
      c.req.param("bundleId"),
      c.req.param("artifactId"),
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
        c.req.param("artifactId"),
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
    const cursor = c.req.query("cursor");
    return c.json(await readRunSection(
      deps.runDetail,
      c.req.param("runId"),
      c.req.param("section"),
      cursor,
      c.req.raw.signal,
    ));
  });
}
