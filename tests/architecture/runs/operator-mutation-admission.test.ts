import { dashboardRouteSource } from "../dashboard/helpers/dashboard-route-source.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "../support/helpers/guard-files.js";
import { describe, it } from "vitest";



type Admission =
  | { readonly guard: "operatorMutationIngressGuard" | "operatorOpaqueIngressGuard" }
  | { readonly inline: string };

const ADMITTED_MUTATIONS: Readonly<Record<string, Admission>> = Object.freeze({
  "/api/v1/assistant/respond": { guard: "operatorMutationIngressGuard" },
  "/api/v1/assistant/action": { guard: "operatorMutationIngressGuard" },
  "/api/v1/debug/errors": { guard: "operatorMutationIngressGuard" },
  "/api/v1/preflight/rerun": { inline: "inspectLoopbackOrigin(c.req.header(\"origin\"))" },
  "/api/v1/exports/xlsx": { guard: "operatorMutationIngressGuard" },
  "/api/v1/exports/search": { guard: "operatorMutationIngressGuard" },
  "/api/v1/explorer/validate": { guard: "operatorMutationIngressGuard" },
  "/api/v1/start-plans": { guard: "operatorMutationIngressGuard" },
  "/api/v1/rerun-warnings": { guard: "operatorMutationIngressGuard" },
  "/api/v1/workbooks": { guard: "operatorMutationIngressGuard" },
  "/api/v1/workbooks/:libraryId/save": { guard: "operatorMutationIngressGuard" },
  "/api/v1/workbooks/:libraryId/intake": { guard: "operatorMutationIngressGuard" },
  "/api/v1/intake/files": { guard: "operatorOpaqueIngressGuard" },
  "/api/v1/commands": { guard: "operatorMutationIngressGuard" },
  "/api/v1/commands/bulk": { guard: "operatorMutationIngressGuard" },
  "/api/v1/settings/chatgpt-account/sign-in": { guard: "operatorMutationIngressGuard" },
  "/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel": { guard: "operatorMutationIngressGuard" },
  "/api/v1/settings/chatgpt-account/test-ocr": { guard: "operatorMutationIngressGuard" },
  "/api/v1/settings/chatgpt-account/sign-out": { guard: "operatorMutationIngressGuard" },
  "/api/v1/settings/path-picker": { guard: "operatorMutationIngressGuard" },
});

const MUTATION_ROUTE = /app\.(post|put|patch|delete)\(\s*"([^"]+)"/g;
const USE_LINE = /app\.use\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g;

const UNCLASSIFIED_REGISTRATION = /app\.(all|on|route)\(|app\.(post|put|patch|delete)\(\s*[^"\s]/g;

interface Audit {
  readonly mutations: readonly string[];
  readonly violations: readonly string[];
}

export function auditOperatorMutationAdmission(source: string, table: Readonly<Record<string, Admission>>): Audit {
  const mutations: string[] = [];
  const violations: string[] = [];
  const uses = new Map<string, { guard: string; index: number }>();
  for (const match of source.matchAll(USE_LINE)) {
    const [, path, guard] = match;
    if (path === undefined || guard === undefined || match.index === undefined) continue;
    uses.set(path, { guard, index: match.index });
  }
  for (const match of source.matchAll(MUTATION_ROUTE)) {
    const [, method, path] = match;
    if (method === undefined || path === undefined || match.index === undefined) continue;
    mutations.push(path);
    const admission = table[path];
    if (admission === undefined) {
      violations.push(`${method.toUpperCase()} ${path} is browser-reachable but has no admission row`);
      continue;
    }
    if ("inline" in admission) {
      const handlerStart = match.index;
      const nextRoute = source.slice(handlerStart + 1).search(/app\.(get|post|put|patch|delete|use)\(/);
      const handler = source.slice(handlerStart, nextRoute === -1 ? undefined : handlerStart + 1 + nextRoute);
      if (!handler.includes(admission.inline)) {
        violations.push(`${method.toUpperCase()} ${path} declares an inline door but its handler does not contain ${admission.inline}`);
      }
      continue;
    }
    const use = uses.get(path);
    if (use === undefined) {
      violations.push(`${method.toUpperCase()} ${path} has no app.use("${path}", ${admission.guard}) line`);
    } else if (use.guard !== admission.guard) {
      violations.push(`${method.toUpperCase()} ${path} is guarded by ${use.guard}, the table says ${admission.guard}`);
    } else if (use.index > match.index) {
      violations.push(`${method.toUpperCase()} ${path} registers its guard AFTER the route; Hono runs middleware in registration order`);
    }
  }
  for (const path of Object.keys(table)) {
    if (!mutations.includes(path)) violations.push(`admission row ${path} names a route the source no longer registers`);
  }
  for (const match of source.matchAll(UNCLASSIFIED_REGISTRATION)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`line ${String(line)} registers a route with a shape this guard does not classify (${match[0].trim()}); use app.<method>("<literal path>") and add its admission row`);
  }
  return Object.freeze({ mutations: Object.freeze(mutations), violations: Object.freeze(violations) });
}

describe("operator mutation admission", () => {
  const source = dashboardRouteSource();

  it("admits every browser-reachable mutating route through a loopback Host/Origin door registered before it", () => {
    const audit = auditOperatorMutationAdmission(source, ADMITTED_MUTATIONS);
    assert.deepEqual(audit.violations, []);
    assert.deepEqual([...audit.mutations].sort(), Object.keys(ADMITTED_MUTATIONS).sort());
  });

  it("admits the public profile and explicit owner-claim routes before request-body effects", () => {
    const publicSource = readFileSync(resolve(REPO_ROOT, "src/backend/app/composition/dashboard/compose.ts"), "utf8");
    const table = Object.fromEntries(["sign-in", "sign-up", "claim-existing-data", "logout", "onboarding/duo/start", "onboarding/duo/confirm",
      "onboarding/duo/cancel", "onboarding/cancel", "onboarding/complete"].map(path => [`/api/v1/profile/${path}`, { guard: "operatorMutationIngressGuard" as const }]));
    assert.deepEqual(auditOperatorMutationAdmission(publicSource, table).violations, []);
  });

  it("catches an unguarded route, a late guard, a wrong guard, a missing inline door, a stale row and every unclassified registration shape", () => {
    const fixture = [
      'app.use("/api/v1/guarded", operatorMutationIngressGuard);',
      'app.post("/api/v1/guarded", handler);',
      'app.post("/api/v1/naked", handler);',
      'app.post("/api/v1/late", handler);',
      'app.use("/api/v1/late", operatorMutationIngressGuard);',
      'app.use("/api/v1/wrong", operatorOpaqueIngressGuard);',
      'app.post("/api/v1/wrong", handler);',
      'app.post("/api/v1/inline", async (c) => { return c.json({}); });',
      'app.get("/api/v1/read", handler);',
      'app.on("POST", "/api/v1/listed", handler);',
      'app.route("/api/v1/mounted", subApp);',
      'app.all("/api/v1/any", handler);',
      'app.post(`/api/v1/${prefix}/templated`, handler);',
    ].join("\n");
    const audit = auditOperatorMutationAdmission(fixture, {
      "/api/v1/guarded": { guard: "operatorMutationIngressGuard" },
      "/api/v1/late": { guard: "operatorMutationIngressGuard" },
      "/api/v1/wrong": { guard: "operatorMutationIngressGuard" },
      "/api/v1/inline": { inline: "inspectLoopbackOrigin(" },
      "/api/v1/gone": { guard: "operatorOpaqueIngressGuard" },
    });
    assert.deepEqual(audit.mutations, ["/api/v1/guarded", "/api/v1/naked", "/api/v1/late", "/api/v1/wrong", "/api/v1/inline"]);
    assert.deepEqual(audit.violations, [
      "POST /api/v1/naked is browser-reachable but has no admission row",
      "POST /api/v1/late registers its guard AFTER the route; Hono runs middleware in registration order",
      "POST /api/v1/wrong is guarded by operatorOpaqueIngressGuard, the table says operatorMutationIngressGuard",
      "POST /api/v1/inline declares an inline door but its handler does not contain inspectLoopbackOrigin(",
      "admission row /api/v1/gone names a route the source no longer registers",
      'line 10 registers a route with a shape this guard does not classify (app.on(); use app.<method>("<literal path>") and add its admission row',
      'line 11 registers a route with a shape this guard does not classify (app.route(); use app.<method>("<literal path>") and add its admission row',
      'line 12 registers a route with a shape this guard does not classify (app.all(); use app.<method>("<literal path>") and add its admission row',
      'line 13 registers a route with a shape this guard does not classify (app.post(`); use app.<method>("<literal path>") and add its admission row',
    ]);
  });
});


it("audits imported registrations at the call site and detects relocated unguarded mutations", () => {
  const entry = "/route-proof/api.ts";
  const child = "/route-proof/child.ts";
  const root = `import { attachChild } from "./child.js";
    export function createDashboardApp() {
      app.use("/guarded", operatorMutationIngressGuard);
      attachChild(app);
    }`;
  const sources = new Map([
    [entry, root],
    [child, `export function attachChild(app) {
      app.post("/guarded", handler);
      app.post("/unguarded", handler);
    }`],
  ]);
  const read = (file: string): string => {
    const source = sources.get(file);
    if (source === undefined) throw new Error(`unknown fixture: ${file}`);
    return source;
  };
  const table = { "/guarded": { guard: "operatorMutationIngressGuard" as const } };
  assert.deepEqual(auditOperatorMutationAdmission(dashboardRouteSource(entry, read), table).violations,
    ["POST /unguarded is browser-reachable but has no admission row"]);
  sources.set(child, `export function attachChild(app) { app.post("/guarded", handler); }`);
  assert.deepEqual(auditOperatorMutationAdmission(dashboardRouteSource(entry, read), table).violations, []);
  sources.set(entry, root.replace('app.use("/guarded", operatorMutationIngressGuard);', "")
    .replace('attachChild(app);', 'attachChild(app); app.use("/guarded", operatorMutationIngressGuard);'));
  assert.match(auditOperatorMutationAdmission(dashboardRouteSource(entry, read), table).violations[0] ?? "", /AFTER the route/u);
  sources.set(child, "export function removed() {}");
  assert.throws(() => dashboardRouteSource(entry, read), /registrar is missing/u);
});
