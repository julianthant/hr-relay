
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { RequestIdentityRefusedError } from "../../../../../src/backend/runs/commands/refusals.js";
import { UUID_4 } from "../../../../support/fixtures/phase1c-contract-fixtures.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("crosses one request-identity checkpoint on every registered route and refuses before effects", async () => {
    let checkpointCalls = 0;
    const h = await harness({
      requestIdentity: {
        identify: () => {
          checkpointCalls += 1;
          throw new RequestIdentityRefusedError("the request identity checkpoint refused this caller");
        },
      },
    });
    const beforeFault = faultAuthoritySnapshot(h);
    const materializePath = (path: string): string => path.replaceAll(/:[^/]+/gu, UUID_4);
    const routes = h.app.routes.filter((route) => route.method !== "ALL");

    assert.ok(routes.length > 0);
    for (const route of routes) {
      checkpointCalls = 0;
      const response = await h.app.request(materializePath(route.path), {
        method: route.method,
        ...(route.method === "GET" || route.method === "HEAD"
          ? {}
          : { headers: { "content-type": "application/json" }, body: "{}" }),
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal(checkpointCalls, 1, `${route.method} ${route.path}`);
      assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    }

    checkpointCalls = 0;
    const unknownResponse = await h.app.request("/api/v1/not-registered");
    assert.equal(unknownResponse.status, 403);
    assert.equal(checkpointCalls, 1);
    assert.equal((await json(unknownResponse)).code, "REQUEST_IDENTITY_REFUSED");

    assertHttpFaultOnly(h, beforeFault, routes.length + 1);
    const artifactRoot = join(h.stateRoot, "artifacts");
    assert.deepEqual(existsSync(artifactRoot) ? readdirSync(artifactRoot) : [], []);
    const inspection = new DatabaseSync(join(h.stateRoot, "state.db"), { readOnly: true });
    try {
      const row = inspection.prepare("SELECT count(*) AS count FROM artifacts WHERE export_id IS NOT NULL").get();
      assert.equal(Reflect.get(row ?? {}, "count"), 0);
    } finally {
      inspection.close();
    }
  });


});

import { assertHttpFaultOnly, disposeHttpRouteHarness, faultAuthoritySnapshot, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
