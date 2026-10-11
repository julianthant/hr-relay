
import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNWIRED_INTAKE_SERVICE } from "../../../../support/fixtures/intake-kernel-seams.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  const FOREIGN_ORIGIN_CASES = [
    ["missing Origin", { host: "localhost" }],
    ["foreign Origin", { host: "localhost", origin: "https://hostile.example" }],
    ["malformed Origin", { host: "localhost", origin: "not an origin" }],
    ["Host-mismatched Origin", { host: "localhost:3938", origin: "http://127.0.0.1:3938" }],
    ["non-loopback Host", { host: "attacker.example", origin: "http://attacker.example" }],
  ] as const;

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses an intake upload with %s before the query, the bytes or the intake service are read",
    async (_label, headers) => {
      let uploads = 0;
      const h = harness({
        intake: {
          ...UNWIRED_INTAKE_SERVICE,
          upload: () => {
            uploads += 1;
            return Promise.resolve({ state: "refused" as const, code: "unreadable-file" as const, message: "unreachable" });
          },
        },
      });
      const request = new Request("http://localhost/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", {
        method: "POST",
        headers: { ...headers, "content-type": "text/csv" },
        body: "eid\n10873698\n",
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
      assert.equal(uploads, 0);
    },
  );

  it("admits a same-origin intake upload under the file's own media type and keeps the route's media contract", async () => {
    const seen: string[] = [];
    const h = harness({
      intake: {
        ...UNWIRED_INTAKE_SERVICE,
        upload: (input) => {
          seen.push(`${input.workflow}|${input.fileName}|${input.mediaType}|${String(input.bytes.byteLength)}`);
          return Promise.resolve({ state: "refused" as const, code: "unreadable-file" as const, message: "the fixture intake accepts nothing" });
        },
      },
    });
    const response = await h.app.request("http://localhost/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "text/csv" },
      body: "eid\n10873698\n",
    });
    // Admitted (not 403/415): the intake service's own refusal answers, under
    // the route's typed intake code — the loopback door never requires JSON here.
    assert.equal(response.status, 422);
    assert.equal((await json(response)).code, "INTAKE_UNREADABLE_FILE");
    assert.deepEqual(seen, ["fixture-graph|roster.csv|text/csv|13"]);
  });
});

import { disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
