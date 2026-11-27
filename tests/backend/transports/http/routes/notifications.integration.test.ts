import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
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

it("serves observation status only through the dashboard stream", async () => {
  const { app } = await harness({ notifications: () => notificationReads });
  assert.equal((await app.request("/api/v1/notifications/status")).status, 404);
});
