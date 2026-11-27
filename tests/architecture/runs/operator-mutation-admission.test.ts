import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "vitest";
import { dashboardRouteRegistrations, publicProfileRouteRegistrations } from "../dashboard/helpers/dashboard-route-source.js";
import { REPO_ROOT } from "../support/helpers/guard-files.js";

type Admission = "operatorMutationIngressGuard" | "operatorOpaqueIngressGuard" | "preflightRerunIngressGuard";

const ADMITTED_MUTATIONS: Readonly<Record<string, Admission>> = Object.freeze({
  "/api/v1/storage/run-history/clear": "operatorMutationIngressGuard",
  "/api/v1/storage/run-history/result": "operatorMutationIngressGuard",
  "/api/v1/assistant/respond": "operatorMutationIngressGuard",
  "/api/v1/assistant/history": "operatorMutationIngressGuard",
  "/api/v1/assistant/conversations/:conversationId/attachments": "operatorOpaqueIngressGuard",
  "/api/v1/debug/errors": "operatorMutationIngressGuard",
  "/api/v1/preflight/rerun": "preflightRerunIngressGuard",
  "/api/v1/exports/xlsx": "operatorMutationIngressGuard",
  "/api/v1/exports/search": "operatorMutationIngressGuard",
  "/api/v1/start-plans": "operatorMutationIngressGuard",
  "/api/v1/rerun-warnings": "operatorMutationIngressGuard",
  "/api/v1/workbooks": "operatorMutationIngressGuard",
  "/api/v1/workbooks/types": "operatorMutationIngressGuard",
  "/api/v1/workbooks/import": "operatorMutationIngressGuard",
  "/api/v1/workbooks/:libraryId/clone": "operatorMutationIngressGuard",
  "/api/v1/workbooks/:libraryId/library-actions": "operatorMutationIngressGuard",
  "/api/v1/workbooks/:libraryId/save": "operatorMutationIngressGuard",
  "/api/v1/workbooks/:libraryId/copy-mapping": "operatorMutationIngressGuard",
  "/api/v1/ocr/files": "operatorOpaqueIngressGuard",
  "/api/v1/commands": "operatorMutationIngressGuard",
  "/api/v1/commands/bulk": "operatorMutationIngressGuard",
  "/api/v1/settings/chatgpt-account/check": "operatorMutationIngressGuard",
  "/api/v1/settings/chatgpt-account/sign-in": "operatorMutationIngressGuard",
  "/api/v1/settings/chatgpt-account/sign-in/:attemptId/cancel": "operatorMutationIngressGuard",
  "/api/v1/settings/chatgpt-account/sign-out": "operatorMutationIngressGuard",
  "/api/v1/settings/chatgpt-account/test-ocr": "operatorMutationIngressGuard",
  "/api/v1/settings/path-picker": "operatorMutationIngressGuard",
});

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

function auditOperatorMutationAdmission(
  source: ReturnType<typeof dashboardRouteRegistrations>,
  table: Readonly<Record<string, Admission>>,
) {
  const mutations: string[] = [];
  const violations = [...source.violations];
  const { registrations } = source;
  for (const [index, route] of registrations.entries()) {
    const { method, path } = route;
    if (!MUTATION_METHODS.has(method)) continue;
    mutations.push(path);
    const label = `${method.toUpperCase()} ${path}`;
    const expected = table[path];
    if (expected === undefined) {
      violations.push(`${label} is browser-reachable but has no admission row`);
      continue;
    }
    const guardedUses = registrations.flatMap((use, position) => {
      const matches = use.path === "*" || use.path === path || (use.path.endsWith("/*") && path.startsWith(use.path.slice(0, -1)));
      return use.method === "use" && matches && use.firstGuard !== undefined ? [{ position, guard: use.firstGuard }] : [];
    });
    const guard = guardedUses.find(({ position }) => position < index)?.guard ?? route.firstGuard;
    if (guard === expected) continue;
    if (guard !== undefined) {
      violations.push(`${label} is guarded by ${guard}, the table says ${expected}`);
    } else if (guardedUses.some(use => use.position > index && use.guard === expected)) {
      violations.push(`${label} registers its guard AFTER the route`);
    } else {
      violations.push(`${label} has no leading ${expected} middleware`);
    }
  }
  for (const path of Object.keys(table)) {
    if (!mutations.includes(path)) violations.push(`admission row ${path} names a route the source no longer registers`);
  }
  return { mutations, violations };
}

describe("operator mutation admission", () => {
  it("admits every browser-reachable mutating route through a loopback Host/Origin door registered before it", () => {
    const audit = auditOperatorMutationAdmission(dashboardRouteRegistrations(), ADMITTED_MUTATIONS);
    assert.deepEqual(audit.violations, []);
    assert.deepEqual([...audit.mutations].sort(), Object.keys(ADMITTED_MUTATIONS).sort());
  });

  it("admits the public profile routes before request-body effects", () => {
    const table = Object.fromEntries(["sign-in", "resume", "sign-up", "logout", "delete-account", "onboarding/duo/browser", "onboarding/duo/reopen", "onboarding/duo/portal", "onboarding/duo/start", "onboarding/duo/confirm",
      "onboarding/duo/cancel", "onboarding/cancel", "onboarding/complete", "account/password", "account/username", "account/details", "account/duo-keys",
      "duo/reenrol/begin", "duo/reenrol/read", "duo/reenrol/browser", "duo/reenrol/reopen", "duo/reenrol/portal", "duo/reenrol/start", "duo/reenrol/confirm",
      "duo/reenrol/cancel-attempt", "duo/reenrol/cancel", "duo/reenrol/commit"].map(path => [`/api/v1/profile/${path}`, "operatorMutationIngressGuard"] as const));
    const audit = auditOperatorMutationAdmission(publicProfileRouteRegistrations(), table);
    assert.deepEqual(audit.violations, []);
    assert.deepEqual([...audit.mutations].sort(), Object.keys(table).sort());
  });
});

const ENTRY = resolve(REPO_ROOT, "src/backend/transports/http/routes/fixture-api.ts");
const CHILD = resolve(dirname(ENTRY), "fixture-child.ts");

function fixtureRegistrations(body: string, child?: string) {
  const root = `
    import { Hono } from "hono";
    import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
    import { register as attachChild } from "./fixture-child.js";
    export function createDashboardApp() {
      const app = new Hono();
      ${body}
    }
  `;
  return dashboardRouteRegistrations(ENTRY, "createDashboardApp", file => {
    if (file === ENTRY) return root;
    if (file === CHILD && child !== undefined) return child;
    throw new Error(`unknown fixture: ${file}`);
  });
}

it("checks the ordered middleware arguments and refuses unsupported registration shapes", () => {
  const source = fixtureRegistrations(`
    app.use("/guarded", operatorMutationIngressGuard);
    app.post("/guarded", handler);
    app.post("/naked", handler);
    app.post("/late", handler);
    app.use("/late", operatorMutationIngressGuard);
    app.use("/wrong", operatorOpaqueIngressGuard);
    app.post("/wrong", handler);
    app.post("/inline", operatorMutationIngressGuard, handler);
    app.post("/late-inline", handler, operatorMutationIngressGuard);
    app.post("/in-handler", async c => { await c.req.json(); return operatorMutationIngressGuard(c, next); });
    app.get("/read", handler);
    const router = app;
    router.on("POST", "/listed", handler);
    router.route("/mounted", subApp);
    router.all("/any", handler);
    router.post(dynamicPath, handler);
  `);
  const audit = auditOperatorMutationAdmission(source, {
    "/guarded": "operatorMutationIngressGuard",
    "/late": "operatorMutationIngressGuard",
    "/wrong": "operatorMutationIngressGuard",
    "/inline": "operatorMutationIngressGuard",
    "/late-inline": "operatorMutationIngressGuard",
    "/in-handler": "operatorMutationIngressGuard",
    "/gone": "operatorOpaqueIngressGuard",
  });
  assert.deepEqual(audit.mutations, ["/guarded", "/naked", "/late", "/wrong", "/inline", "/late-inline", "/in-handler"]);
  assert.deepEqual(audit.violations.map(violation => violation.replace(/^.* has an unclassified Hono registration: /u, "")), [
    'router.on("POST", "/listed", handler)',
    'router.route("/mounted", subApp)',
    'router.all("/any", handler)',
    "router.post(dynamicPath, handler)",
    "POST /naked is browser-reachable but has no admission row",
    "POST /late registers its guard AFTER the route",
    "POST /wrong is guarded by operatorOpaqueIngressGuard, the table says operatorMutationIngressGuard",
    "POST /late-inline has no leading operatorMutationIngressGuard middleware",
    "POST /in-handler has no leading operatorMutationIngressGuard middleware",
    "admission row /gone names a route the source no longer registers",
  ]);
});

it("resolves aliased Hono receivers and imported registrars at their call sites", () => {
  const guard = 'app.use("/guarded", operatorMutationIngressGuard);';
  const guarded = 'export function register(deps, router) { router.post("/guarded", handler); }';
  const unguarded = `export function register(deps, router) {
    const nested = router;
    function unrelated(router) { router.post("/not-a-hono-route", handler); }
    nested.post("/guarded", handler);
    nested.post("/unguarded", handler);
  }`;
  const attach = "const alias = app; attachChild(deps, alias);";
  const table = { "/guarded": "operatorMutationIngressGuard" as const };
  assert.deepEqual(auditOperatorMutationAdmission(fixtureRegistrations(`${guard} ${attach}`, unguarded), table).violations,
    ["POST /unguarded is browser-reachable but has no admission row"]);
  assert.deepEqual(auditOperatorMutationAdmission(fixtureRegistrations(`${guard} ${attach}`, guarded), table).violations, []);
  assert.deepEqual(auditOperatorMutationAdmission(fixtureRegistrations(`${attach} ${guard}`, guarded), table).violations,
    ["POST /guarded registers its guard AFTER the route"]);
  assert.throws(() => fixtureRegistrations(attach, "export function removed() {}"), /registrar is missing/u);
  assert.throws(() => fixtureRegistrations(attach, "export function register(deps, { router }) {}"), /expected one Hono binding/u);
});

it.each([
  "attachChild({ app });",
  "attachChild({ router: app });",
  "attachChild([app]);",
  "attachChild(...[app]);",
  "attachChild({ ...app });",
  "const alias = app; attachChild({ alias });",
  "return app;",
])("fails closed when the Hono binding escapes through %s", source => {
  const { registrations, violations } = fixtureRegistrations(source);
  assert.deepEqual(registrations, []);
  assert.equal(violations.length, 1);
  assert.match(violations[0] ?? "", /unclassified Hono binding use: (app|alias)$/u);
});
