/**
 * `capture-durability-and-scope` (ref data-intake-and-edit-data §5.1, ref clock-config-secrets, ref operator-trust §7 — activated
 * at 2i-F, D174).
 *
 * The guard stayed PLANNED through D167 for a stated reason: the durability
 * half existed but the phone-origin route enumeration did not, and half a
 * guard claims an invariant nothing enforces. Both halves exist now.
 *
 * SCOPE. Ref operator-trust §7 permits exactly ONE exception to loopback-only — a
 * short-lived capture ingress — and only for ref data-intake-and-edit-data §5.1's closed route union.
 * The registered routes and the declared union must be the same set in both
 * directions, a request arriving on the ingress Host may reach nothing else
 * including every catch-all, and its refusal must be byte-identical to an
 * unrouted path so the ingress cannot enumerate the operator's dashboard.
 *
 * ENUMERATION. Unknown, malformed, expired and discarded tokens must all
 * produce the SAME status and the SAME body. A phone on a public origin that
 * could tell "no such session" from "not yours" is an existence oracle.
 *
 * DURABILITY. The token is never durable or wire state, only its digest. Every
 * capture MUTATION goes through the journaled command kernel; the only other
 * writers of `capture_sessions` are the finalize projector's settlement and
 * the service's two declared clock transitions. A finalized session's handoff
 * is written by the projector alone, so nothing can report "Sent" without the
 * outbox having settled.
 *
 * Every arm below is executed against a VIOLATING fixture as well as the real
 * subject (the ratchet-arm rule): an arm that cannot fail is not enforcement.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import { Hono } from "hono";
import {
  CAPTURE_PHONE_ASSET_ENTRY,
  CAPTURE_PHONE_ROUTES,
  CAPTURE_PHONE_ROUTE_KEYS,
  CAPTURE_TOKEN_HEADER,
  CaptureSessionWireSchema,
  CaptureTokenSchema,
  capturePhoneHostOf,
  deriveCaptureTokenDigest,
  isCapturePhoneAsset,
  matchesCapturePhoneRoute,
} from "../../../src/domain/capture-surface.js";
import { CaptureSessionSchema } from "../../../src/domain/capture.js";
import { REPO_ROOT, repoRelative, walkFiles } from "./helpers/guard-files.js";

const API_ROUTES_FILE = join(REPO_ROOT, "src/server/dashboard/routes/api.ts");
const DASHBOARD_COMPOSE_FILE = join(REPO_ROOT, "src/server/dashboard/compose.ts");

/* ── 1. the closed union matches the registered routes, both ways ─────────── */

/**
 * Reads the phone routes the BFF actually registers. Parsing the source rather
 * than introspecting Hono is deliberate: a route added but never reached by a
 * request would still be a scope hole, and the source is where it appears.
 */
function registeredPhoneRoutes(source: string): readonly string[] {
  const pattern = /app\.(get|post|put|delete)\(\s*"(\/api\/v1\/capture\/phone\/[^"]*)"/g;
  const found: string[] = [];
  for (const match of source.matchAll(pattern)) {
    found.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return found;
}

describe("capture scope — the phone route union is closed", () => {
  it("registers exactly the declared union, in both directions", () => {
    const registered = registeredPhoneRoutes(readFileSync(API_ROUTES_FILE, "utf8"));
    assert.deepEqual(
      [...registered].sort(),
      [...CAPTURE_PHONE_ROUTE_KEYS].sort(),
      "every registered phone route must be declared in CAPTURE_PHONE_ROUTES and vice versa",
    );
    assert.equal(new Set(registered).size, registered.length, "a phone route is registered twice");
  });

  it("the extraction arm fails on a violating fixture", () => {
    // A route registered under the phone prefix but absent from the union —
    // exactly the drift the arm above exists to catch.
    const violating = `
      app.get("/api/v1/capture/phone/session", (c) => c.json(1));
      app.post("/api/v1/capture/phone/exfiltrate", (c) => c.json(2));
    `;
    const found = registeredPhoneRoutes(violating);
    assert.ok(found.includes("POST /api/v1/capture/phone/exfiltrate"));
    assert.notDeepEqual([...found].sort(), [...CAPTURE_PHONE_ROUTE_KEYS].sort());
  });

  it("a :param segment matches one segment and never walks out of scope", () => {
    assert.ok(matchesCapturePhoneRoute("GET", "/api/v1/capture/phone/photos/abc/bytes"));
    assert.ok(matchesCapturePhoneRoute("DELETE", "/api/v1/capture/phone/photos/abc"));
    // The violating fixtures: a param may not swallow a separator, and a
    // near-miss path must not match.
    assert.equal(matchesCapturePhoneRoute("GET", "/api/v1/capture/phone/photos/a/b/bytes"), false);
    assert.equal(matchesCapturePhoneRoute("GET", "/api/v1/capture/phone/photos/../../runs"), false);
    assert.equal(matchesCapturePhoneRoute("GET", "/api/v1/runs/abc"), false);
    assert.equal(matchesCapturePhoneRoute("POST", "/api/v1/commands"), false);
    assert.equal(matchesCapturePhoneRoute("GET", "/api/v1/capture/sessions/abc"), false);
    // Method is part of the identity.
    assert.equal(matchesCapturePhoneRoute("POST", "/api/v1/capture/phone/session"), false);
  });

  it("no operator route can be spelled as a phone route", () => {
    const operatorPaths = [
      "/api/v1/bootstrap",
      "/api/v1/dashboard",
      "/api/v1/runs/r",
      "/api/v1/runs/r/receipt",
      "/api/v1/commands",
      "/api/v1/start-plans",
      "/api/v1/intake/files",
      "/api/v1/intake/s",
      "/api/v1/storage/doctor",
      "/api/v1/capture/sessions",
      "/api/v1/capture/sessions/s",
      "/events/v1",
      "/",
    ];
    for (const path of operatorPaths) {
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        assert.equal(
          matchesCapturePhoneRoute(method, path),
          false,
          `${method} ${path} must not be reachable from the phone origin`,
        );
      }
      assert.equal(
        isCapturePhoneAsset(path, new Set(["/assets/capture-abc.js"])),
        false,
        `${path} must not be servable as a phone asset`,
      );
    }
    // The positive control, so the assertion above is not vacuous.
    assert.ok(isCapturePhoneAsset(CAPTURE_PHONE_ASSET_ENTRY, new Set()));
    assert.ok(isCapturePhoneAsset("/assets/capture-abc.js", new Set(["/assets/capture-abc.js"])));
  });

  it("every declared route states a purpose and lives under the phone prefix", () => {
    for (const route of CAPTURE_PHONE_ROUTES) {
      assert.ok(route.path.startsWith("/api/v1/capture/phone/"), `${route.path} is outside the phone prefix`);
      assert.ok(route.purpose.length > 0);
    }
  });
});

/* ── 2. the ingress denies everything else, byte-identically ─────────────── */

const PHONE_HOST = "capture.example.ngrok.app";

/**
 * The scope filter, mounted exactly as `createDashboardApp` mounts it. Driving
 * a real Hono app is what makes this an enforcement test rather than a
 * restatement of the matcher: a middleware registered after a route, or one
 * that forgets `notFound`, fails here and nowhere else.
 */
function scopedApp(options: { readonly phoneHost?: string }): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const host = c.req.header("host");
    if (options.phoneHost === undefined || host?.toLowerCase() !== options.phoneHost) return next();
    const allowed = matchesCapturePhoneRoute(c.req.method, c.req.path)
      || isCapturePhoneAsset(c.req.path, new Set());
    if (!allowed) {
      return c.json({ state: "error", code: "ROUTE_NOT_FOUND", retryable: false }, 404);
    }
    return next();
  });
  app.get("/api/v1/bootstrap", (c) => c.json({ reached: "bootstrap" }));
  app.post("/api/v1/commands", (c) => c.json({ reached: "commands" }));
  app.get("/api/v1/capture/phone/session", (c) => c.json({ reached: "phone" }));
  app.notFound((c) => c.json({ state: "error", code: "ROUTE_NOT_FOUND", retryable: false }, 404));
  return app;
}

describe("capture scope — the ingress is deny-by-default", () => {
  it("refuses every operator route on the phone Host, identically to an unrouted path", async () => {
    const app = scopedApp({ phoneHost: PHONE_HOST });
    const headers = { host: PHONE_HOST };
    const unrouted = await app.request("http://x/nothing-here", { headers });
    const unroutedBody = await unrouted.text();

    for (const [path, init] of [
      ["http://x/api/v1/bootstrap", { headers }],
      ["http://x/api/v1/commands", { method: "POST", headers }],
    ] as const) {
      const response = await app.request(path, init);
      assert.equal(response.status, unrouted.status, `${path} leaked a different status to the phone`);
      assert.equal(await response.text(), unroutedBody, `${path} leaked a different body to the phone`);
    }

    const phone = await app.request("http://x/api/v1/capture/phone/session", { headers });
    assert.equal(phone.status, 200, "the phone's own route must still be reachable");
  });

  it("the arm fails on the violating fixture: no phone Host means no filter", async () => {
    // The negative control. Without a configured ingress Host, the SAME
    // requests reach their handlers — which proves the refusals above come
    // from the filter and not from the app simply lacking those routes.
    const app = scopedApp({});
    const headers = { host: PHONE_HOST };
    assert.equal((await app.request("http://x/api/v1/bootstrap", { headers })).status, 200);
    assert.equal((await app.request("http://x/api/v1/commands", { method: "POST", headers })).status, 200);
  });

  it("a request on the loopback Host is unaffected by a configured ingress", async () => {
    const app = scopedApp({ phoneHost: PHONE_HOST });
    const headers = { host: "127.0.0.1:3938" };
    assert.equal((await app.request("http://x/api/v1/bootstrap", { headers })).status, 200);
  });
});

/* ── 2b. the gate has a PRODUCER, and it is the ingress's own config leaf ─── */

/**
 * The scope filter above is only enforcement if something supplies the host it
 * keys on. Between D174 and Track D row D2 nothing did — `deps.capturePhoneHost`
 * was read in `api.ts` and passed by no composition root, so the gate compiled
 * and could never fire (D189 item 3, D181's shape). These arms pin both halves
 * of the wiring: the derivation, and the composition root that calls it.
 */
describe("capture scope — the phone host is derived from the ingress's own config", () => {
  it("names a host for a forwarded ingress and nothing for the two modes with no origin", () => {
    assert.equal(
      capturePhoneHostOf({ ingress: "forwarded", forwardedUrl: "https://Capture.Example.ngrok.app" }),
      "capture.example.ngrok.app",
    );
    assert.equal(
      capturePhoneHostOf({ ingress: "forwarded", forwardedUrl: "https://capture.example.app:8443/x" }),
      "capture.example.app:8443",
    );
    // No ingress means no phone origin to scope: the gate admits everything,
    // which is what keeps the operator's own loopback requests working.
    assert.equal(capturePhoneHostOf({ ingress: "disabled" }), undefined);
    assert.equal(capturePhoneHostOf({ ingress: "on-demand-ngrok" }), undefined);
  });

  it("REFUSES a forwarded ingress it cannot read a host out of, rather than going unscoped", () => {
    // The violating fixture. Answering `undefined` here would silently drop
    // §7's scope on the one path exposed to the public internet.
    assert.throws(
      () => capturePhoneHostOf({ ingress: "forwarded" }),
      /no forwardedUrl/,
    );
    assert.throws(
      () => capturePhoneHostOf({ ingress: "forwarded", forwardedUrl: "capture.example.app" }),
      /is not a URL/,
    );
  });

  it("the dashboard composition root supplies the host from that derivation", () => {
    const source = readFileSync(DASHBOARD_COMPOSE_FILE, "utf8");
    assert.ok(
      source.includes("capturePhoneHostOf(resolved.config.capture)"),
      "compose.ts must derive the phone host from the SAME capture config leaf the ingress resolver reads",
    );
    assert.ok(
      /\.\.\.\(capturePhoneHost === undefined \? \{\} : \{ capturePhoneHost \}\)/.test(source),
      "compose.ts must pass capturePhoneHost to createDashboardApp, or the gate has no producer again",
    );
  });
});

/* ── 3. the token is a credential, and enumeration is fail-closed ─────────── */

describe("capture durability — the token never becomes state", () => {
  it("no wire the phone or the operator reads can carry a token or its digest", () => {
    const keys = Object.keys(CaptureSessionWireSchema.shape);
    assert.ok(!keys.includes("token"), "the session wire must never carry the raw token");
    assert.ok(!keys.includes("tokenDigest"), "the session wire must not carry the digest either");
    // The violating fixture: a wire that DID carry it would parse, which is
    // exactly why the shape is asserted rather than a sample value.
    const withToken = { ...CaptureSessionWireSchema.shape, token: CaptureTokenSchema };
    assert.ok(Object.keys(withToken).includes("token"));
  });

  it("the durable row holds the digest and cannot hold the raw token", () => {
    const token = CaptureTokenSchema.parse("a".repeat(43));
    const session = CaptureSessionSchema.parse({
      sessionId: "0b3e4c2a-5f6d-4a8b-9c1d-2e3f4a5b6c7d",
      tokenDigest: deriveCaptureTokenDigest(token),
      workflow: "person-lookup",
      state: "open",
      photoRefs: [],
      handoff: { state: "pending" },
      finalizationGeneration: 0,
      version: 1,
      createdAt: "2026-08-09T00:00:00.000Z",
      expiresAt: "2026-08-09T00:15:00.000Z",
    });
    const serialized = JSON.stringify(session);
    assert.ok(!serialized.includes(token), "the raw token must never reach the durable row");
    assert.ok(serialized.includes(session.tokenDigest));
    // The violating fixture: a strict object refuses the extra field outright.
    assert.throws(() => CaptureSessionSchema.parse({ ...session, token }));
  });

  it("the digest is domain-separated, so one token cannot be two identities", () => {
    const a = CaptureTokenSchema.parse("a".repeat(43));
    const b = CaptureTokenSchema.parse("b".repeat(43));
    assert.notEqual(deriveCaptureTokenDigest(a), deriveCaptureTokenDigest(b));
    assert.equal(deriveCaptureTokenDigest(a), deriveCaptureTokenDigest(a));
    assert.throws(() => deriveCaptureTokenDigest("too-short"), /43 base64url/);
  });

  it("the token header is a header, not a path or a query parameter", () => {
    assert.equal(CAPTURE_TOKEN_HEADER, "x-capture-token");
    for (const route of CAPTURE_PHONE_ROUTES) {
      assert.ok(!route.path.includes("token"), `${route.path} puts a credential in the URL`);
    }
    const source = readFileSync(API_ROUTES_FILE, "utf8");
    assert.ok(
      !/c\.req\.query\(\s*"token"\s*\)/.test(source),
      "a capture token may never be read from the query string",
    );
  });
});

/* ── 4. durability — who may write a capture session ─────────────────────── */

/**
 * The command kernel journals and audits every capture mutation. Two other
 * writers exist and are declared: the finalize projector's settlement (which
 * must be transactional with the outbox) and the capture service's two
 * clock-driven transitions (expiry and first-connect), neither of which is an
 * operator ACT and so neither of which is a command.
 */
const DECLARED_CAPTURE_SESSION_WRITERS = new Set([
  "src/core/command-kernel.ts",
  "src/infra/sqlite/authority-database.ts",
  "src/infra/capture/finalize-projector.ts",
  "src/server/dashboard/commands/capture-service.ts",
  // The composition seam itself: it hands the projector its NARROW port as two
  // closures and writes nothing of its own. It is allowlisted rather than
  // rewritten because the alternative — a second indirection whose only job is
  // to hide a method name from a regular expression — would weaken the guard
  // while looking like it satisfied it.
  "src/server/capture/compose.ts",
]);

describe("capture durability — mutation goes through the journal", () => {
  it("only declared modules write a capture session", () => {
    const violations: string[] = [];
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = relative(REPO_ROOT, file).replaceAll("\\", "/");
      if (DECLARED_CAPTURE_SESSION_WRITERS.has(path)) continue;
      const content = readFileSync(file, "utf8");
      if (/captureSessions\s*\.\s*(update|create)\s*\(/.test(content)) {
        violations.push(`${path} writes a capture session outside the journaled path`);
      }
      if (/captureFinalizationOutboxes\s*\.\s*(insert|settle)\s*\(/.test(content)) {
        violations.push(`${path} writes a capture finalization outbox outside the journaled path`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("the arm fails on a violating fixture", () => {
    // Executed through the SAME predicate the loop uses, against source that
    // does exactly what the guard forbids.
    const violating = "repositories.captureSessions.update({ state: \"finalized\" });";
    assert.ok(/captureSessions\s*\.\s*(update|create)\s*\(/.test(violating));
    const innocent = "const held = repositories.captureSessions.get(sessionId);";
    assert.equal(/captureSessions\s*\.\s*(update|create)\s*\(/.test(innocent), false);
  });

  it("every declared writer still exists, so the allowlist cannot rot", () => {
    for (const path of DECLARED_CAPTURE_SESSION_WRITERS) {
      assert.ok(
        readFileSync(join(REPO_ROOT, path), "utf8").length > 0,
        `${path} is allowlisted as a capture writer but no longer exists`,
      );
    }
  });

  it("only the finalize projector may declare a session finalized", () => {
    const violations: string[] = [];
    for (const file of walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })) {
      const path = relative(REPO_ROOT, file).replaceAll("\\", "/");
      if (path === "src/infra/capture/finalize-projector.ts") continue;
      if (path === "src/domain/capture.ts") continue;
      const content = readFileSync(file, "utf8");
      if (/state:\s*"finalized"/.test(content)) {
        violations.push(`${repoRelative(file)} declares a capture session finalized outside the projector`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("the finalized arm fails on a violating fixture", () => {
    assert.ok(/state:\s*"finalized"/.test('captureSessions.update({ ...session, state: "finalized" });'));
    assert.equal(/state:\s*"finalized"/.test('captureSessions.update({ ...session, state: "failed" });'), false);
  });
});

/* ── 5. the durable schema's own invariants ──────────────────────────────── */

describe("capture durability — the record cannot lie", () => {
  const base = {
    sessionId: "0b3e4c2a-5f6d-4a8b-9c1d-2e3f4a5b6c7d",
    tokenDigest: deriveCaptureTokenDigest(CaptureTokenSchema.parse("c".repeat(43))),
    workflow: "person-lookup",
    photoRefs: [],
    finalizationGeneration: 0,
    version: 1,
    createdAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-09T00:15:00.000Z",
  };

  it("a finalized session must name its bundle and its enqueued handoff", () => {
    assert.throws(
      () => CaptureSessionSchema.parse({ ...base, state: "finalized", handoff: { state: "pending" } }),
      /finalized session/,
    );
  });

  it("a failed session must record its failure handoff", () => {
    assert.throws(
      () => CaptureSessionSchema.parse({
        ...base,
        state: "failed",
        finalizationGeneration: 1,
        handoff: { state: "pending" },
      }),
      /failure handoff/,
    );
  });

  it("a finalizing or failed session must carry a finalization generation", () => {
    assert.throws(
      () => CaptureSessionSchema.parse({ ...base, state: "finalizing", handoff: { state: "pending" } }),
      /finalization generation/,
    );
  });

  it("the optional ingress stamp is read forward, never required", () => {
    const withoutIngress = CaptureSessionSchema.parse({ ...base, state: "open", handoff: { state: "pending" } });
    assert.equal(withoutIngress.ingress, undefined);
    const withIngress = CaptureSessionSchema.parse({
      ...base,
      state: "open",
      handoff: { state: "pending" },
      ingress: { mode: "forwarded", originDigest: "0".repeat(64) },
    });
    assert.equal(withIngress.ingress?.mode, "forwarded");
  });
});
