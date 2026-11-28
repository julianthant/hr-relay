import assert from "node:assert/strict";
import { Hono } from "hono";
import { afterAll, afterEach, it, vi } from "vitest";
import { z } from "zod";
import { composeNotificationRoutes, createHistoryNotificationTarget } from "../../../../../src/backend/app/composition/dashboard/notification-wiring.js";
import { createComposedDashboardReadHost } from "../../../../../src/backend/app/composition/dashboard/runtime-resources.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createNotificationInbox } from "../../../../../src/backend/runs/notifications/inbox.js";
import { createNotificationObserver } from "../../../../../src/backend/runs/notifications/observation.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerNotificationRoutes } from "../../../../../src/backend/transports/http/routes/notifications.js";
import { NotificationWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { NotificationTargetSchema } from "../../../../../src/models/notifications/notification-target.js";
import { NotificationCollectionTargetSchema } from "../../../../../src/models/notifications/notifications.js";
import { ActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import { createProfileFixtureSet, findProfileFixtureAdmission } from "../../../../support/helpers/admission-fixture.js";
import { uuidOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { createRunDetailTestWorld } from "../../../../support/helpers/backend/run-detail-world.js";
import { createRunQueueProjectionTestWorld } from "../../../../support/helpers/backend/run-queue-projection-world.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import { WireErrorSchema } from "../../../../../src/models/dashboard/primitives.js";
import { disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";

afterEach(disposeHttpRouteHarness);

const collectionPath = "/api/v1/notifications/collection";
const notificationReads = {
  snapshot: () => [],
  status: () => ({ state: "ready" as const, pending: 0 }),
  target: () => { throw new Error("unexpected notification target read"); },
};

it("returns an unavailable error when notification collection support is absent", async () => {
  const { app } = await harness({ notifications: () => notificationReads });
  const response = await app.request(`${collectionPath}?operation=read`);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    state: "error", code: "SECTION_UNAVAILABLE", message: "Notification collection is unavailable", retryable: false,
  });
});

it("refuses an invalid collection operation before querying notification authority", async () => {
  const { app, database } = await harness({
    notifications: database => ({
      ...notificationReads,
      collection: (actor, operation) => database.withAuthorityReadSnapshot(() => database.authority.notifications.collection(actor, operation)),
    }),
  });
  const authorityRead = vi.spyOn(database, "withAuthorityReadSnapshot");
  const response = await app.request(`${collectionPath}?operation=invalid`);

  assert.equal(response.status, 400);
  const { state, code, retryable } = WireErrorSchema.parse(await response.json());
  assert.deepEqual({ state, code, retryable }, { state: "error", code: "SCHEMA_INVALID", retryable: false });
  assert.equal(authorityRead.mock.calls.length, 0);
});

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const projectionWorld = createRunQueueProjectionTestWorld(profiles.create);
afterEach(projectionWorld.cleanup);

it("serves notification reads and stream refreshes on a lane with the main read connection disabled", async () => {
  const w = await projectionWorld.world();
  const profile = findProfileFixtureAdmission(w.stateRoot);
  assert.ok(profile);
  const { database, clock } = w;
  let seed = 100;
  const ids = { uuid: () => uuidOf(++seed) };
  const lifecycle = new RunRecordService({ database, clock, ids, publishQueued: () => undefined });
  const inbox = createNotificationInbox({ authority: database, clock, ids, actorId: "local-operator" });
  const observer = { ...createNotificationObserver({ inbox, read: () => ({ observations: [], diagnostics: [] }), health: async () => undefined }),
    healthDueAt: () => Infinity };
  const lanes = createComposedDashboardReadHost({ admission: profile, database, clock });
  try {
    const routes = composeNotificationRoutes({ database, clock, lifecycle, descriptors: { resolve: () => personLookupDescriptor },
      runDetailDeps: createRunDetailTestWorld().depsOf(w), assertCurrent: () => undefined, notificationObserver: observer,
      notificationTarget: createHistoryNotificationTarget(database, lifecycle), readLanes: lanes });
    await inbox.publish({ kind: "storage-degraded", concern: "backup", state: "failed", diagnosticFingerprint: "1".repeat(64) });
    const app: DashboardApp = new Hono();
    app.use("*", async (c, next) => { c.set("requestActorId", ActorIdSchema.parse("local-operator")); await next(); });
    registerNotificationRoutes(app, { notifications: routes });
    const read = async (path: string) => {
      const response = await app.request(path);
      const body: unknown = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    };
    const snapshot = vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementation(() => { throw new Error("main-connection read"); });
    try {
      const rows = z.array(NotificationWireSchema).parse(await read("/api/v1/notifications"));
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.ok(row?.kind === "notification");
      assert.deepEqual(row.context, { state: "storage", concern: "backup" });
      NotificationCollectionTargetSchema.parse(await read(`${collectionPath}?operation=read`));
      NotificationTargetSchema.parse(await read(`/api/v1/notifications/${row.notificationId}/target`));
      assert.deepEqual(await routes.streamList.read(), rows);
      const changed = vi.fn();
      const stop = routes.streamList.onChange(changed);
      try {
        await routes.pollList();
        assert.equal(changed.mock.calls.length, 0);
      } finally { stop(); }
      assert.equal(snapshot.mock.calls.length, 0);
    } finally { snapshot.mockRestore(); }
  } finally { await lanes.close(); }
});

it("serves observation status only through the dashboard stream", async () => {
  const { app } = await harness({ notifications: () => notificationReads });
  assert.equal((await app.request("/api/v1/notifications/status")).status, 404);
});
