/**
 * The BFF's static byte path (ref frontend-backend-integration §6.9): the decision table is
 * pinned without a socket, then a real temp bundle proves the physical half —
 * symlink escape, content types, cache headers, SPA fallback, API precedence,
 * HEAD, and the fail-loud refusal to open a bundle with no index.html.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { Hono } from "hono";
import { writeDashboardBuildIdentity } from "../../../src/backend/app/dashboard/build-identity.js";
import { afterEach, describe, it } from "vitest";
import type { ActorId } from "../../../src/domain/ids.js";
import {
  decideStaticBundlePath,
  openStaticBundle,
  staticBundleHandler,
  type StaticBundle,
} from "../../../src/backend/transports/dashboard/static-bundle.js";

type TestDashboardEnv = { Variables: { requestActorId: ActorId } };

const roots: string[] = [];
const REPO_ROOT = resolve(import.meta.dirname, "../../..");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A scratch repo root with a built-looking dist/dashboard and a secret outside it. */
function scaffold(): { repoRoot: string; dist: string; outside: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-static-bundle-"));
  roots.push(repoRoot);
  const dist = join(repoRoot, "dist", "dashboard");
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dist, "nested"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>dashboard</title>");
  writeFileSync(join(dist, "assets", "app.abc123.js"), "console.log('app');");
  writeFileSync(join(dist, "assets", "app.abc123.css"), "body{}");
  writeFileSync(join(dist, "favicon.svg"), "<svg/>");
  writeFileSync(join(dist, "nested", "readme.txt"), "nested");
  writeFileSync(join(dist, "unlisted.exe"), "MZ");
  mkdirSync(join(dist, "dir.js"));
  writeFileSync(join(repoRoot, "package.json"), '{"name":"secret-package"}');
  const outside = join(repoRoot, "secret.txt");
  writeFileSync(outside, "not for the browser");
  symlinkSync(outside, join(dist, "escape.txt"));
  symlinkSync(join(dist, "favicon.svg"), join(dist, "inside.svg"));
  mkdirSync(join(repoRoot, "elsewhere"));
  writeFileSync(join(repoRoot, "elsewhere", "leak.js"), "leak");
  symlinkSync(join(repoRoot, "elsewhere"), join(dist, "linked-dir"));
  writeDashboardBuildIdentity({ repoRoot: REPO_ROOT, distDir: dist });
  return { repoRoot, dist, outside };
}

async function appOver(bundle: StaticBundle): Promise<Hono<TestDashboardEnv>> {
  const app = new Hono<TestDashboardEnv>();
  app.get("/api/v1/ping", (c) => c.json({ pong: true }));
  app.get("/events/v1", (c) => c.text("stream", 200, { "content-type": "text/event-stream" }));
  app.use("*", staticBundleHandler(bundle));
  app.notFound((c) => c.json({ state: "error", code: "ROUTE_NOT_FOUND", message: `no route serves ${c.req.method} ${c.req.path}`, retryable: false }, 404));
  return Promise.resolve(app);
}

describe("static bundle decision table", () => {
  const GET = (rawPath: string) => decideStaticBundlePath({ method: "GET", rawPath });

  it("passes API, events and non-GET/HEAD requests through to the app's own routes", () => {
    assert.deepEqual(GET("/api/v1/nope"), { kind: "pass-through" });
    assert.deepEqual(GET("/api"), { kind: "pass-through" });
    assert.deepEqual(GET("/events/v1"), { kind: "pass-through" });
    assert.deepEqual(decideStaticBundlePath({ method: "POST", rawPath: "/index.html" }), { kind: "pass-through" });
    assert.deepEqual(decideStaticBundlePath({ method: "DELETE", rawPath: "/" }), { kind: "pass-through" });
  });

  it("refuses every traversal and forbidden-character shape by name", () => {
    assert.deepEqual(GET("/../package.json"), { kind: "refused", reason: "dot-segment" });
    assert.deepEqual(GET("/%2e%2e/package.json"), { kind: "refused", reason: "dot-segment" });
    assert.deepEqual(GET("/a/../../package.json"), { kind: "refused", reason: "dot-segment" });
    assert.deepEqual(GET("/..%2fpackage.json"), { kind: "refused", reason: "dot-segment" });
    assert.deepEqual(GET("/assets/../index.html"), { kind: "refused", reason: "dot-segment" });
    assert.deepEqual(GET("/./index.html"), { kind: "refused", reason: "dot-segment" });
    assert.deepEqual(GET("/assets\\app.js"), { kind: "refused", reason: "forbidden-character" });
    assert.deepEqual(GET("/index.html%00.js"), { kind: "refused", reason: "forbidden-character" });
    assert.deepEqual(GET("//etc/passwd"), { kind: "refused", reason: "outside-bundle" });
    assert.deepEqual(GET("/assets//app.js"), { kind: "refused", reason: "outside-bundle" });
    assert.deepEqual(GET("/%E0%A4%A"), { kind: "refused", reason: "malformed-encoding" });
  });

  it("names the file, its type and its cache policy; unlisted extensions are not found", () => {
    assert.deepEqual(GET("/"), { kind: "file", relativeSegments: ["index.html"], contentType: "text/html; charset=utf-8", cacheControl: "no-cache" });
    assert.deepEqual(GET("/index.html"), { kind: "file", relativeSegments: ["index.html"], contentType: "text/html; charset=utf-8", cacheControl: "no-cache" });
    assert.deepEqual(GET("/assets/app.abc123.js"), { kind: "file", relativeSegments: ["assets", "app.abc123.js"], contentType: "text/javascript; charset=utf-8", cacheControl: "public, max-age=31536000, immutable" });
    assert.deepEqual(GET("/assets/app.abc123.css"), { kind: "file", relativeSegments: ["assets", "app.abc123.css"], contentType: "text/css; charset=utf-8", cacheControl: "public, max-age=31536000, immutable" });
    assert.deepEqual(GET("/favicon.svg"), { kind: "file", relativeSegments: ["favicon.svg"], contentType: "image/svg+xml", cacheControl: "no-cache" });
    assert.deepEqual(GET("/FONT.WOFF2"), { kind: "file", relativeSegments: ["FONT.WOFF2"], contentType: "font/woff2", cacheControl: "no-cache" });
    assert.deepEqual(GET("/unlisted.exe"), { kind: "not-found" });
    assert.deepEqual(GET("/assets/nameless"), { kind: "not-found" });
  });

  it("hands extension-less routes to the SPA", () => {
    assert.deepEqual(GET("/runs/abc"), { kind: "spa-fallback" });
    assert.deepEqual(GET("/archive/"), { kind: "spa-fallback" });
    assert.deepEqual(decideStaticBundlePath({ method: "HEAD", rawPath: "/settings" }), { kind: "spa-fallback" });
  });
});

describe("static bundle over a real temp bundle", () => {
  it("refuses to open a bundle that is missing or has no index.html, naming the build command", async () => {
    const { repoRoot } = scaffold();
    await assert.rejects(openStaticBundle(join(repoRoot, "dist", "nowhere"), REPO_ROOT), /npm run web:build/u);
    const bare = join(repoRoot, "dist", "bare");
    mkdirSync(bare, { recursive: true });
    await assert.rejects(openStaticBundle(bare, REPO_ROOT), /no index\.html.*npm run web:build/u);
    mkdirSync(join(bare, "index.html"));
    await assert.rejects(openStaticBundle(bare, REPO_ROOT), /has no index\.html/u);
  });

  it("refuses missing, stale, or changed build identity before opening the bundle", async () => {
    const { dist } = scaffold();
    const identityPath = join(dist, "dashboard-build-identity.json");
    unlinkSync(identityPath);
    await assert.rejects(openStaticBundle(dist, REPO_ROOT), /missing dashboard-build-identity\.json/u);
    writeDashboardBuildIdentity({ repoRoot: REPO_ROOT, distDir: dist });
    const identity = JSON.parse(readFileSync(identityPath, "utf8")) as Record<string, unknown>;
    writeFileSync(identityPath, JSON.stringify({ ...identity, inputDigest: "0".repeat(64) }));
    await assert.rejects(openStaticBundle(dist, REPO_ROOT), /bundle inputs changed after build/u);
    writeDashboardBuildIdentity({ repoRoot: REPO_ROOT, distDir: dist });
    writeFileSync(join(dist, "assets", "app.abc123.js"), "changed after build");
    await assert.rejects(openStaticBundle(dist, REPO_ROOT), /bundle bytes changed after build/u);
  });

  it("serves bundle bytes with exact headers, falls back to the SPA, and keeps API precedence", async () => {
    const { dist } = scaffold();
    const app = await appOver(await openStaticBundle(dist, REPO_ROOT));

    const index = await app.request("http://127.0.0.1:3938/");
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(index.headers.get("cache-control"), "no-cache");
    assert.equal(index.headers.get("x-content-type-options"), "nosniff");
    assert.match(await index.text(), /<title>dashboard<\/title>/u);

    const asset = await app.request("http://127.0.0.1:3938/assets/app.abc123.js");
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(asset.headers.get("content-length"), String("console.log('app');".length));
    assert.equal(await asset.text(), "console.log('app');");

    const nested = await app.request("http://127.0.0.1:3938/nested/readme.txt");
    assert.equal(nested.status, 200);
    assert.equal(await nested.text(), "nested");

    const spa = await app.request("http://127.0.0.1:3938/runs/9e8d7c6b");
    assert.equal(spa.status, 200);
    assert.equal(spa.headers.get("cache-control"), "no-cache");
    assert.match(await spa.text(), /<title>dashboard<\/title>/u);

    const missingAsset = await app.request("http://127.0.0.1:3938/assets/app.zzz.js");
    assert.equal(missingAsset.status, 404);
    assert.equal(((await missingAsset.json()) as { code: string }).code, "ROUTE_NOT_FOUND");

    const unlisted = await app.request("http://127.0.0.1:3938/unlisted.exe");
    assert.equal(unlisted.status, 404);

    const api = await app.request("http://127.0.0.1:3938/api/v1/ping");
    assert.deepEqual(await api.json(), { pong: true });
    const unknownApi = await app.request("http://127.0.0.1:3938/api/v1/nope");
    assert.equal(unknownApi.status, 404);
    assert.equal(((await unknownApi.json()) as { code: string }).code, "ROUTE_NOT_FOUND", "an unknown API path is a JSON 404, never index.html");
    const events = await app.request("http://127.0.0.1:3938/events/v1");
    assert.equal(await events.text(), "stream");

    const head = await app.request("http://127.0.0.1:3938/index.html", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await head.text(), "");

    const posted = await app.request("http://127.0.0.1:3938/index.html", { method: "POST" });
    assert.equal(posted.status, 404, "a POST to a bundle path reaches the app's own 404, never the bundle");
  });

  it("refuses traversal and a symlink that leaves the bundle, and follows one that stays inside", async () => {
    const { dist } = scaffold();
    const app = await appOver(await openStaticBundle(dist, REPO_ROOT));
    // The WHATWG URL layer (in Node's Request and in every browser) resolves a
    // literal `/../` before any handler sees it, so that form can only ever
    // name a bundle-relative path — here a missing one. The ENCODED forms are
    // what reach the handler intact, and those it must refuse itself.
    for (const normalizedUpstream of ["/../package.json", "/%2e%2e/package.json", "/%2E%2E/package.json"]) {
      const response = await app.request(`http://127.0.0.1:3938${normalizedUpstream}`);
      assert.equal(response.status, 404, normalizedUpstream);
      assert.doesNotMatch(await response.text(), /secret-package/u, "the repo's package.json never leaves the bundle");
    }
    for (const path of ["/..%2fpackage.json", "/assets%5c..%5cindex.html", "//etc/passwd", "/%E0%A4%A"]) {
      const refused = await app.request(`http://127.0.0.1:3938${path}`);
      assert.equal(refused.status, 400, path);
      const body = (await refused.json()) as { code: string; message: string };
      assert.equal(body.code, "STATIC_PATH_REFUSED", path);
      assert.doesNotMatch(body.message, /package|passwd|etc/u, "the refused path is never echoed");
    }
    const escape = await app.request("http://127.0.0.1:3938/escape.txt");
    assert.equal(escape.status, 400);
    assert.equal(((await escape.json()) as { code: string }).code, "STATIC_PATH_REFUSED");
    const viaLinkedDir = await app.request("http://127.0.0.1:3938/linked-dir/leak.js");
    assert.equal(viaLinkedDir.status, 400, "a symlinked directory that leaves the bundle is refused too");
    const inside = await app.request("http://127.0.0.1:3938/inside.svg");
    assert.equal(inside.status, 200);
    assert.equal(await inside.text(), "<svg/>");
    const directory = await app.request("http://127.0.0.1:3938/dir.js");
    assert.equal(directory.status, 404, "a directory named like an asset is never served");
    const tooLong = await app.request(`http://127.0.0.1:3938/${"a".repeat(300)}.js`);
    assert.equal(tooLong.status, 404, "a name the filesystem cannot hold names nothing in the bundle");
  });

  it("decides pass-through on the decoded path too, so an encoded API path never falls to index.html", async () => {
    const { dist } = scaffold();
    const app = await appOver(await openStaticBundle(dist, REPO_ROOT));
    for (const path of ["/api%2Fv1/bootstrap", "/api%2fv1%2fnope", "/events%2Fv1", "/artifacts/v1/x/"]) {
      const response = await app.request(`http://127.0.0.1:3938${path}`);
      assert.equal(response.status, 404, path);
      assert.equal(((await response.json()) as { code: string }).code, "ROUTE_NOT_FOUND", path);
    }
  });

  it("puts a fixed message on the wire when the filesystem fails, never the bundle path", async () => {
    const { dist } = scaffold();
    const bundle = await openStaticBundle(dist, REPO_ROOT);
    const app = new Hono<TestDashboardEnv>();
    app.use("*", staticBundleHandler(bundle));
    app.onError((error, c) => c.json({ name: error.name, message: error.message }, 500));
    chmodSync(join(dist, "favicon.svg"), 0o000);
    try {
      const response = await app.request("http://127.0.0.1:3938/favicon.svg");
      if (response.status === 200) return; // running as a user that ignores mode bits (root); nothing to prove here
      assert.equal(response.status, 500);
      const body = (await response.json()) as { name: string; message: string };
      assert.equal(body.name, "StaticBundleReadError");
      assert.equal(body.message, "the static bundle could not read the requested file");
      assert.doesNotMatch(body.message, /favicon|dist|hrauto/u);
    } finally {
      chmodSync(join(dist, "favicon.svg"), 0o644);
    }
  });

  it("refuses to open a bundle whose index.html is a symlink out of it", async () => {
    const { repoRoot, outside } = scaffold();
    const linked = join(repoRoot, "dist", "linked");
    mkdirSync(linked, { recursive: true });
    symlinkSync(outside, join(linked, "index.html"));
    await assert.rejects(openStaticBundle(linked, REPO_ROOT), /resolves outside the bundle/u);
  });
});
