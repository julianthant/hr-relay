/**
 * 2i-E3 — the intake half of the ONE typed client.
 *
 * The upload route is the only place in the product where the response STATUS
 * is the answer rather than a transport detail: the same session wire comes
 * back whether a session was CREATED for these bytes or an open one was
 * JOINED, and the difference is the whole message to the operator. So these
 * cases are about the status line, and about what happens when it is a status
 * the contract does not admit — which must fail loud rather than fall through
 * to the nearest plausible outcome.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../../../src/dashboard/client/index.js";
import {
  FIXTURE_INTAKE_IDS,
  FIXTURE_INTAKE_MAPPING,
} from "../../../../parity/helpers/fixture-intake.js";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly contentType: string | undefined;
}

function clientOver(
  respond: (call: Call) => { status: number; body: unknown },
): { client: ReturnType<typeof createDashboardClient>; calls: Call[] } {
  const calls: Call[] = [];
  const client = createDashboardClient({
    baseUrl: "http://bff.test",
    fetchImpl: (url, init) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        contentType: headers.get("content-type") ?? undefined,
      };
      calls.push(call);
      const { status, body } = respond(call);
      return Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }));
    },
  });
  return { client, calls };
}

const BYTES = new TextEncoder().encode("UCPath ID,Employee Name\n10873698,Battistessa, Johnnie\n");

function upload(client: ReturnType<typeof createDashboardClient>) {
  return client.uploadIntakeFile({
    workflowId: "person-lookup",
    fileName: "cohort 7.csv",
    mediaType: "text/csv",
    bytes: BYTES.buffer.slice(0),
  });
}

describe("the intake upload's status IS the outcome", () => {
  it("reads 201 as created and 200 as joined, over the same wire", async () => {
    const created = clientOver(() => ({ status: 201, body: FIXTURE_INTAKE_MAPPING }));
    assert.equal((await upload(created.client)).state, "created");

    const joined = clientOver(() => ({ status: 200, body: FIXTURE_INTAKE_MAPPING }));
    const outcome = await upload(joined.client);
    assert.equal(outcome.state, "joined");
    assert.equal(
      outcome.state === "joined" ? outcome.session.intakeSessionId : undefined,
      FIXTURE_INTAKE_IDS.mapping,
    );
  });

  it("sends the workflow and the file name as query, and the bytes as the body", async () => {
    const { client, calls } = clientOver(() => ({ status: 201, body: FIXTURE_INTAKE_MAPPING }));
    await upload(client);
    assert.equal(calls.length, 1);
    // The file name is REQUIRED by the route (D171) and must survive a space.
    assert.equal(
      calls[0].url,
      "http://bff.test/api/v1/intake/files?workflow=person-lookup&filename=cohort%207.csv",
    );
    assert.equal(calls[0].method, "POST");
    // Not application/json: the route reads the media type off this header.
    assert.equal(calls[0].contentType, "text/csv");
  });

  it("returns a 422 refusal with the server's own code and words", async () => {
    const { client } = clientOver(() => ({
      status: 422,
      body: {
        state: "error",
        code: "INTAKE_UNREADABLE_SOURCE",
        message: "this file is not a spreadsheet this system can read",
        retryable: false,
      },
    }));
    const outcome = await upload(client);
    assert.deepEqual(outcome, {
      state: "refused",
      code: "INTAKE_UNREADABLE_SOURCE",
      message: "this file is not a spreadsheet this system can read",
    });
  });

  /**
   * The load-bearing negative. A permissive client would treat any non-2xx as
   * "refused", which reports a server defect as the operator's bad file — and
   * the operator would go looking at a spreadsheet that is perfectly fine.
   */
  it("throws on a status outside {201, 200, 422} rather than calling it a refusal", async () => {
    const { client } = clientOver(() => ({
      status: 500,
      body: { state: "error", code: "INTERNAL_FAILURE", message: "the artifact store is unreachable", retryable: true },
    }));
    await assert.rejects(upload(client), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.kind, "http");
      assert.equal(error.status, 500);
      assert.equal(error.code, "INTERNAL_FAILURE");
      return true;
    });
  });

  it("refuses a 422 whose body is outside the wire-error contract", async () => {
    const { client } = clientOver(() => ({ status: 422, body: { oops: true } }));
    await assert.rejects(upload(client), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.kind, "schema");
      return true;
    });
  });
});

describe("the intake session read", () => {
  it("parses through the session wire schema and encodes its id", async () => {
    const { client, calls } = clientOver(() => ({ status: 200, body: FIXTURE_INTAKE_MAPPING }));
    const session = await client.intakeSession(FIXTURE_INTAKE_IDS.mapping);
    assert.equal(session.intakeSessionId, FIXTURE_INTAKE_IDS.mapping);
    assert.equal(calls[0].url, `http://bff.test/api/v1/intake/${FIXTURE_INTAKE_IDS.mapping}`);
    // Suggestions ride BESIDE bindings and are never folded into them (§2.5).
    assert.equal(session.bindings.length, 1);
    assert.equal(session.suggestions.length > session.bindings.length, true);
  });

  it("fails loud when the server sends something the contract does not admit", async () => {
    const { client } = clientOver(() => ({
      status: 200,
      body: { ...FIXTURE_INTAKE_MAPPING, suggestions: [{ targetFieldId: "emplId" }] },
    }));
    await assert.rejects(client.intakeSession(FIXTURE_INTAKE_IDS.mapping), (error: unknown) => {
      assert.ok(error instanceof DashboardClientError);
      assert.equal(error.kind, "schema");
      return true;
    });
  });
});
