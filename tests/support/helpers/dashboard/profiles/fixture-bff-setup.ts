import { registerFixturePreflightRoutes } from "../../../../parity/helpers/fixture-preflight-routes.js";
import { wireError } from "../../../fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import type { FixtureBffOptions, FixtureDashboardProfile } from "../../../fixtures/dashboard/fixture-profile.js";
import { type ParityBundleProof } from "../served-fixtures/bundle.js";
import { createStaticAssetFixture } from "../static-assets.js";
import type * as DiagnosticJpegFixtureTypes from "../../../fixtures/dashboard/diagnostic-jpeg-fixture.js";
import type * as FixtureDayTypes from "../../../fixtures/dashboard/fixture-day.js";
import type * as FixtureDiagnosticTypes from "../../../fixtures/dashboard/fixture-diagnostic.js";
import type * as FixtureProfileTypes from "../../../fixtures/dashboard/fixture-profile.js";
import type * as FixtureQueueTypes from "../../../fixtures/dashboard/fixture-queue.js";
import type * as FixtureRunCapturesTypes from "../../../fixtures/dashboard/fixture-run-captures.js";
import type * as BundleTypes from "../served-fixtures/bundle.js";
import type * as FixtureActivityRoutesTypes from "../served-fixtures/fixture-activity-routes.js";
import type * as FixtureDetailRoutesTypes from "../served-fixtures/fixture-detail-routes.js";
import type * as FixtureExplorerRoutesTypes from "../served-fixtures/fixture-explorer-routes.js";
import type * as FixtureIntakeRoutesTypes from "../served-fixtures/fixture-intake-routes.js";
import type * as FixtureQueueRoutesTypes from "../served-fixtures/fixture-queue-routes.js";
import type * as FixtureSettingsRoutesTypes from "../served-fixtures/fixture-settings-routes.js";
import type * as FixtureShellRoutesTypes from "../served-fixtures/fixture-shell-routes.js";
import type * as FixtureStartRoutesTypes from "../served-fixtures/fixture-start-routes.js";
import type * as FixtureStorageRoutesTypes from "../served-fixtures/fixture-storage-routes.js";


export interface FixtureArtifactExchange {
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
}

export interface FixtureServer {
  readonly port: number;
  readonly baseUrl: string;
  artifactExchanges(): readonly Readonly<FixtureArtifactExchange>[];
  publish(envelope: DashboardStreamEnvelope): void;
  close(): Promise<void>;
}

export function createFixtureBffSetup({ restrictedJpegDiagnosticFixture, FIXTURE_COMMAND_RESULTS, FIXTURE_DIAGNOSTIC_BUNDLE, FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST, FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES, DEFAULT_DASHBOARD_PROFILE, FIXTURE_DAY_WIRE, FIXTURE_IDS, FIXTURE_RUN_CAPTURE_DAY, assertServedBundle, registerFixtureActivityRoutes, registerFixtureDetailRoutes, registerFixtureExplorerRoutes, registerFixtureIntakeRoutes, registerFixtureQueueRoutes, registerFixtureSettingsRoutes, registerFixtureShellRoutes, registerFixtureStartRoutes, registerFixtureStorageRoutes }: {
restrictedJpegDiagnosticFixture: typeof DiagnosticJpegFixtureTypes.restrictedJpegDiagnosticFixture;
FIXTURE_COMMAND_RESULTS: typeof FixtureDayTypes.FIXTURE_COMMAND_RESULTS;
FIXTURE_DIAGNOSTIC_BUNDLE: typeof FixtureDiagnosticTypes.FIXTURE_DIAGNOSTIC_BUNDLE;
FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST: typeof FixtureDiagnosticTypes.FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST;
FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES: typeof FixtureDiagnosticTypes.FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES;
DEFAULT_DASHBOARD_PROFILE: typeof FixtureProfileTypes.DEFAULT_DASHBOARD_PROFILE;
FIXTURE_DAY_WIRE: typeof FixtureQueueTypes.FIXTURE_DAY_WIRE;
FIXTURE_IDS: typeof FixtureQueueTypes.FIXTURE_IDS;
FIXTURE_RUN_CAPTURE_DAY: typeof FixtureRunCapturesTypes.FIXTURE_RUN_CAPTURE_DAY;
assertServedBundle: typeof BundleTypes.assertServedBundle;
registerFixtureActivityRoutes: typeof FixtureActivityRoutesTypes.registerFixtureActivityRoutes;
registerFixtureDetailRoutes: typeof FixtureDetailRoutesTypes.registerFixtureDetailRoutes;
registerFixtureExplorerRoutes: typeof FixtureExplorerRoutesTypes.registerFixtureExplorerRoutes;
registerFixtureIntakeRoutes: typeof FixtureIntakeRoutesTypes.registerFixtureIntakeRoutes;
registerFixtureQueueRoutes: typeof FixtureQueueRoutesTypes.registerFixtureQueueRoutes;
registerFixtureSettingsRoutes: typeof FixtureSettingsRoutesTypes.registerFixtureSettingsRoutes;
registerFixtureShellRoutes: typeof FixtureShellRoutesTypes.registerFixtureShellRoutes;
registerFixtureStartRoutes: typeof FixtureStartRoutesTypes.registerFixtureStartRoutes;
registerFixtureStorageRoutes: typeof FixtureStorageRoutesTypes.registerFixtureStorageRoutes;
}) {
  function fixtureHelloEnvelope(profile: FixtureDashboardProfile = DEFAULT_DASHBOARD_PROFILE): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "hello",
      wireVersion: 1,
      descriptorHash: profile.descriptorHash,
      projectionGeneration: 1,
      cursor: "pc:1",
    });
  }

  function fixtureSnapshotEnvelope(
    dayWire: DashboardDayWire = FIXTURE_DAY_WIRE,
    cursor = "pc:1",
  ): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({
      type: "snapshot",
      topic: "dashboard-day",
      cursor,
      payload: dayWire,
    });
  }

  function fixtureHealthEnvelope(): DashboardStreamEnvelope {
    return DashboardStreamEnvelopeSchema.parse({ type: "health", state: "live" });
  }

  function sseSerialize(envelope: DashboardStreamEnvelope): string {
    const id = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
    return `${id}data: ${JSON.stringify(envelope)}\n\n`;
  }

  const CommandBodyProbeSchema = z.looseObject({
    target: z.looseObject({ runId: z.string().optional() }).optional(),
  });

  function createFixtureBff(
    input: FixtureBffOptions = {},
  ): { app: Hono } {
    const app = new Hono();
    const profile = input.profile ?? DEFAULT_DASHBOARD_PROFILE;
    const runCaptureEvidence = input.runCaptureScenario === "evidence";
    const dayWire = input.dayWire ?? (runCaptureEvidence ? FIXTURE_RUN_CAPTURE_DAY : profile.day);
    if (input.diagnosticFixture !== undefined && input.diagnosticFixture !== "restricted-jpeg") {
      throw new Error(`unknown diagnostic fixture ${String(input.diagnosticFixture)}`);
    }
    const diagnostic = input.diagnosticFixture === "restricted-jpeg" ? restrictedJpegDiagnosticFixture() : {
      bundle: FIXTURE_DIAGNOSTIC_BUNDLE,
      manifest: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
      screenshotBytes: FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES,
    };
    registerFixtureShellRoutes({ app, profile });

    registerFixtureQueueRoutes({ app, dayWire });

    registerFixtureDetailRoutes({ app, runCaptureEvidence, diagnostic });

    registerFixtureStartRoutes({ app, profile });

    registerFixtureSettingsRoutes({ app });

    // This surrounding-shell fixture intentionally has no runtime readiness authority.
    if (input.preflightScenario) registerFixturePreflightRoutes(app, profile, input.preflightScenario);
    else app.get("/api/v1/preflight", c => c.json({ state: "unavailable", reason: "This shell fixture does not compose runtime readiness." }));

    registerFixtureStorageRoutes({ app });

    registerFixtureExplorerRoutes({ app });


    registerFixtureActivityRoutes({ app });

    registerFixtureIntakeRoutes({ app });


    app.post("/api/v1/commands", async (c) => {
      const body = CommandBodyProbeSchema.parse(await c.req.json());
      if (profile.commandResult !== undefined) return c.json(profile.commandResult as unknown);
      const runId = body.target?.runId;
      if (runId === FIXTURE_IDS.conflictRun) return c.json(FIXTURE_COMMAND_RESULTS.conflict as unknown, 409);
      if (runId === FIXTURE_IDS.rejectedRun) return c.json(FIXTURE_COMMAND_RESULTS.rejected as unknown, 422);
      return c.json(FIXTURE_COMMAND_RESULTS.applied as unknown);
    });

    app.all("/api/*", (c) => c.json(wireError("ROUTE_NOT_FOUND", `no fixture route serves ${c.req.method} ${c.req.path}`), 404));

    return { app };
  }

  const serveStatic = createStaticAssetFixture();

  function serveSse(
    res: ServerResponse,
    open: Set<ServerResponse>,
    profile: FixtureDashboardProfile,
    dayWire: DashboardDayWire,
  ): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(sseSerialize(fixtureHelloEnvelope(profile)));
    res.write(sseSerialize(fixtureSnapshotEnvelope(dayWire)));
    res.write(sseSerialize(fixtureHealthEnvelope()));
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15_000);
    open.add(res);
    res.on("close", () => {
      clearInterval(heartbeat);
      open.delete(res);
    });
  }

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async function startFixtureServer(
    input: Readonly<{
      distDir: string;
      bundle: ParityBundleProof;
      profile?: FixtureDashboardProfile;
      dayWire?: DashboardDayWire;
      diagnosticFixture?: "restricted-jpeg";
      runCaptureScenario?: "evidence";
      preflightScenario?: FixtureBffOptions["preflightScenario"];
    }>,
  ): Promise<FixtureServer> {

    assertServedBundle(input.distDir, input.bundle);
    const profile = input.profile ?? DEFAULT_DASHBOARD_PROFILE;
    const dayWire = input.dayWire ?? (input.runCaptureScenario === "evidence" ? FIXTURE_RUN_CAPTURE_DAY : profile.day);
    const { app } = createFixtureBff({ profile, dayWire,
      ...(input.diagnosticFixture === undefined ? {} : { diagnosticFixture: input.diagnosticFixture }),
      ...(input.runCaptureScenario === undefined ? {} : { runCaptureScenario: input.runCaptureScenario }),
      ...(input.preflightScenario === undefined ? {} : { preflightScenario: input.preflightScenario }),
    });
    const openStreams = new Set<ServerResponse>();
    const artifactExchanges: FixtureArtifactExchange[] = [];

    const server: Server = createServer((req, res) => {
      void (async (): Promise<void> => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/events/v1") {
          serveSse(res, openStreams, profile, dayWire);
          return;
        }

        const genericCapture = /^\/artifacts\/v1\/(?!archive(?:\/|$))[^/.]+(?:\/[^/.]+)*$/u.test(url.pathname)
          || /^\/artifacts\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/.]|$)/iu.test(url.pathname);
        if (url.pathname.startsWith("/api/") || genericCapture) {
          const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
          const response = await app.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
            method: req.method ?? "GET",
            headers: Object.fromEntries(
              Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
            ),
            ...(body === undefined ? {} : { body: new Uint8Array(body) }),
          }));
          if (genericCapture) {
            artifactExchanges.push(Object.freeze({
              method: req.method ?? "GET",
              pathname: url.pathname,
              status: response.status,
            }));
          }
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          res.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
        await serveStatic(input.distDir, url.pathname, res);
      })().catch((error: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify(wireError("INTERNAL_FAILURE", error instanceof Error ? error.message : String(error))));
      });
    });

    await new Promise<void>((resolvePromise) => {
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("fixture server bound no TCP address");
    }
    return Object.freeze({
      port: address.port,
      baseUrl: `http://127.0.0.1:${address.port}`,
      artifactExchanges: () => Object.freeze(artifactExchanges.map(exchange => Object.freeze({ ...exchange }))),
      publish(envelope: DashboardStreamEnvelope): void {
        if (openStreams.size === 0) throw new Error("the fixture server has no open SSE stream to publish to");
        const serialized = sseSerialize(DashboardStreamEnvelopeSchema.parse(envelope));
        for (const stream of openStreams) stream.write(serialized);
      },
      close: async (): Promise<void> => {
        for (const stream of openStreams) stream.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolvePromise, rejectPromise) => {
          server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
        });
      },
    });
  }

  return { fixtureHelloEnvelope, fixtureSnapshotEnvelope, fixtureHealthEnvelope, createFixtureBff, startFixtureServer };
}
