import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NormalizeContactInputSchema } from "../../../../../src/domain/contracts/normalization/normalize-contact.js";
import { readContactAdviceTask } from "../../../../../src/stores/normalization/index.js";

const READ_AT = "2026-08-08T12:00:00.000Z";
const RESOLVED_CENSUS = {
  state: "produced",
  value: {
    schemaHash: "ab".repeat(32),
    value: {
      state: "resolved",
      street: "Fixture Road",
      city: "Exampletown",
      stateCode: "CA",
      zip: "90000",
      matchedAddress: "123 FIXTURE RD, EXAMPLETOWN, CA, 90000",
      confidence: "exact",
    },
  },
};
const UNAVAILABLE = {
  state: "unavailable",
  reason: { code: "rate-exhausted", message: "throttled", retryAt: "2026-08-08T12:01:00.000Z" },
};

function scriptedClient(capability: string, response: unknown, calls: string[], requests: unknown[]) {
  return {
    capability,
    call: (payload: unknown) => {
      calls.push(capability);
      requests.push(payload);
      return Promise.resolve(response);
    },
  };
}

async function runAdvice(
  contact: Record<string, string>,
  options: Readonly<{ geocode?: boolean; ai?: boolean; census?: unknown; nominatim?: unknown }>,
) {
  const calls: string[] = [];
  const requests: unknown[] = [];
  const recorded: unknown[] = [];
  const unused = { state: "unavailable", reason: { code: "adapter-unavailable", message: "unused" } };
  const ctx = {
    providers: {
      "geocode.census": scriptedClient("geocode.census", options.census ?? unused, calls, requests),
      "geocode.nominatim": scriptedClient("geocode.nominatim", options.nominatim ?? unused, calls, requests),
      "ai.advisory": scriptedClient("ai.advisory", unused, calls, requests),
    },
    recordData: (point: unknown) => { recorded.push(point); },
    fail: (code: string, message: string) => {
      throw Object.assign(new Error(message), { code });
    },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  };
  try {
    const output = await readContactAdviceTask.impl.run({
      input: NormalizeContactInputSchema.parse({
        contact,
        geocode: options.geocode ?? false,
        ai: options.ai ?? false,
        readAt: READ_AT,
      }),
      ctx: ctx as never,
    });
    return { output, calls, requests, recorded };
  } catch (error) {
    const caught = error as Error & { code?: string };
    if (caught.code === undefined) throw error;
    return { failure: { code: caught.code, message: caught.message }, calls, requests, recorded };
  }
}

describe("normalization task wrapper", () => {
  it("returns deterministic rule advice without touching provider clients", async () => {
    const result = await runAdvice({
      cellPhone: "(858) 555-1212",
      state: "california",
      relationship: "Wife",
    }, {});
    assert.equal("output" in result, true);
    if (!("output" in result)) throw new Error("expected normalization advice");

    assert.equal(result.output.normalized.cellPhone, "8585551212");
    assert.equal(result.output.normalized.state, "CA");
    assert.equal(result.output.relationshipCanonical, "Spouse");
    assert.deepEqual(result.output.disposition, { kind: "complete" });
    assert.deepEqual(result.calls, []);
    const recorded = result.recorded[0] as readonly { direction: string; field: string; value: unknown }[];
    assert.deepEqual(recorded.map(({ direction, field }) => [direction, field]), [
      ["read", "normalized"],
      ["read", "relationshipCanonical"],
      ["read", "changes"],
      ["read", "disposition"],
    ]);
    assert.deepEqual(recorded.find(({ field }) => field === "normalized")?.value, {
      cellPhone: "8585551212",
      state: "CA",
      relationship: "Spouse",
    });
    assert.deepEqual(recorded.find(({ field }) => field === "disposition")?.value, { kind: "complete" });
  });

  it("uses injected census advice and retains the observation instant in changed facts", async () => {
    const result = await runAdvice({
      address1: "123 Fixture Rd",
      city: "example town",
      state: "CA",
      postalCode: "90001",
    }, { geocode: true, census: RESOLVED_CENSUS });
    assert.equal("output" in result, true);
    if (!("output" in result)) throw new Error("expected geocode advice");

    assert.deepEqual(result.calls, ["geocode.census"]);
    assert.deepEqual((result.requests[0] as { value: unknown }).value, {
      street: "123 Fixture Rd",
      city: "example town",
      state: "CA",
      zip: "90001",
    });
    const city = result.output.changes.find((change) => change.field === "city");
    assert.ok(city !== undefined);
    assert.equal(city.after, "Exampletown");
    assert.deepEqual(city.source, { kind: "census", observedAt: READ_AT, confidence: "exact" });
    assert.equal(result.output.normalized.postalCode, "90000");
    assert.deepEqual(result.output.disposition, { kind: "complete" });
  });

  it("keeps exhausted geocoder advice explicit instead of returning an empty success", async () => {
    const result = await runAdvice({
      address1: "123 Fixture Rd",
      state: "CA",
    }, { geocode: true, census: UNAVAILABLE, nominatim: UNAVAILABLE });
    assert.equal("output" in result, true);
    if (!("output" in result)) throw new Error("expected an advice disposition");

    assert.deepEqual(result.calls, ["geocode.census", "geocode.nominatim"]);
    assert.deepEqual(result.requests.map((request) => (request as { value: unknown }).value), [
      { street: "123 Fixture Rd", state: "CA" },
      { street: "123 Fixture Rd", state: "CA" },
    ]);
    assert.equal(result.output.disposition.kind, "advisory-unavailable");
    if (result.output.disposition.kind === "advisory-unavailable") {
      assert.deepEqual(
        result.output.disposition.unavailable.map((failure) => failure.capability),
        ["geocode.census", "geocode.nominatim"],
      );
    }
  });

  it("keeps sensitive relationship text ambiguous without sending it to AI", async () => {
    const withheld = await runAdvice({ relationship: "acquaintance from work" }, { ai: true });
    assert.equal("output" in withheld, true);
    if (!("output" in withheld)) throw new Error("expected ambiguous advice");
    assert.deepEqual(withheld.calls, []);
    assert.deepEqual(withheld.requests, []);
    assert.deepEqual(withheld.output.disposition, { kind: "ambiguous", fields: ["relationship"] });
    const recorded = withheld.recorded[0] as readonly { field: string; value: unknown }[];
    assert.deepEqual(recorded.find(({ field }) => field === "disposition")?.value, {
      kind: "ambiguous",
      fields: ["relationship"],
    });
  });

  it("refuses an empty contact without recording a normalized result", async () => {
    const empty = await runAdvice({}, {});
    assert.equal("failure" in empty, true);
    if ("failure" in empty) {
      assert.equal(empty.failure.code, "empty-contact");
      assert.match(empty.failure.message, /carries no fields/u);
      assert.deepEqual(empty.recorded, []);
      assert.deepEqual(empty.calls, []);
    }
  });
});




