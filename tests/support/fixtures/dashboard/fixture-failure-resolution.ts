/** D-local fixture: unchanged shell corpus; actual HTTP admission, kernel and durable failure reads. */
import { createServer,request as proxyRequest } from "node:http";
import { SavedArchiveReportWireSchema } from "../../../../src/models/dashboard/archive.js";
import { buildTrustSection } from "../../../../src/backend/runs/queries/run-trust.js";
import { resolutionApp,resolutionCommand,resolutionFixture,resolutionPeer,resolutionReadDeps } from "../../helpers/failure-resolution/fixtures.js";
import type { ParityBundleProof } from "../../../integration/dashboard/client/fixtures/helpers/bundle.js";
import { FIXTURE_ARCHIVED_RUN,FIXTURE_SAVED_REPORT } from "./fixture-archive.js";
import { startFixtureServer } from "../../../integration/dashboard/client/fixtures/helpers/fixture-bff.js";
import { FIXTURE_IDS } from "./fixture-queue.js";

export async function startFailureResolutionServer(input: { distDir: string; bundle: ParityBundleProof }) {
  const base = await startFixtureServer(input);
  const f = resolutionFixture(FIXTURE_IDS.failedRun, FIXTURE_IDS.failureId);
  const app = resolutionApp(f);
  let failReads = false;
  let reads = 0;
  let paused: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let archived: unknown;
  const exchanges: { method: string; path: string; status: number }[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const failurePath = `/api/v1/runs/${f.record.runId}/failure`;
    const actual = path === "/api/v1/commands" || path === failurePath;
    if (actual) {
      void (async () => {
        if (path === failurePath) {
          reads++;
          if (failReads) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ state: "error", code: "SECTION_UNAVAILABLE", message: "Synthetic resolution read unavailable", retryable: true })); return; }
        } else if (paused !== undefined) await paused;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          if (!(chunk instanceof Uint8Array)) throw new Error("non-byte request chunk");
          chunks.push(Buffer.from(chunk));
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
        const response = await app.request(`http://${req.headers.host}${req.url}`, { method: req.method, headers,
          ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks).toString("utf8") }) });
        exchanges.push({ method: req.method ?? "GET", path, status: response.status });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
      })().catch(error => { res.writeHead(500); res.end(String(error)); });
      return;
    }
    if (path === `/api/v1/archive/reports/${FIXTURE_ARCHIVED_RUN.runId}` && archived !== undefined) {
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(archived)); return;
    }
    const proxy = proxyRequest(`${base.baseUrl}${req.url}`, { method: req.method, headers: req.headers }, upstream => {
      res.writeHead(upstream.statusCode ?? 500, upstream.headers); upstream.pipe(res);
    });
    proxy.on("error", error => { if (!res.headersSent) res.writeHead(500); res.end(error.message); });
    req.pipe(proxy); res.on("close", () => proxy.destroy());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("fixture has no port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`, runId: f.record.runId, failureId: f.record.failureId,
    failReads: (value: boolean) => { failReads = value; }, reads: () => reads, exchanges: () => exchanges,
    pauseCommands: () => { paused = new Promise<void>(resolve => { release = resolve; }); },
    releaseCommands: () => { release?.(); paused = undefined; },
    externalAction: async (action: "resolve" | "reopen", note?: string) => {
      const current = f.db.authority.failureResolution.read(f.record.runId, f.record.failureId);
      if (!current) throw new Error("missing annotation");
      const peer = resolutionPeer(f.path);
      try { return await peer.send(resolutionCommand({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: current.resolution.version },
        payload: action === "reopen" ? { action } : { action, ...(note === undefined ? {} : { note }) } })); }
      finally { peer.stop(); }
    },
    captureArchive: () => {
      const section = buildTrustSection(resolutionReadDeps(f), f.record.runId, "failure");
      if (section.section !== "failure" || section.payload.state !== "available") throw new Error("missing failure capture");
      const value = section.payload.value;
      // Presentation-only saved snapshot fixture; archive conversion is L/A/H's proof.
      if (value.resolution === undefined) throw new Error("missing resolution capture");
      const resolution = value.resolution.capture.resolution;
      archived = SavedArchiveReportWireSchema.parse({ ...FIXTURE_SAVED_REPORT, sections: [
        { kind: "values", title: "Problem follow-up", values: [
          { label: "Status", value: resolution.status },
          { label: "Version", value: resolution.version },
          ...(resolution.status === "resolved" ? [
            { label: "Resolved by", value: resolution.by },
            { label: "Resolved at", value: resolution.at },
            ...(resolution.note === undefined ? [] : [{ label: "Note", value: resolution.note }]),
          ] : []),
        ] },
      ] });
      return FIXTURE_ARCHIVED_RUN.runId;
    },
    close: async () => {
      release?.(); server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      f.dispose(); await base.close();
    },
  };
}
