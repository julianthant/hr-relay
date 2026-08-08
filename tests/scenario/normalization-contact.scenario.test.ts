/**
 * Executable scenarios for `normalization/read-contact-advice` (doc 06 §4.2).
 *
 * These run the REAL task implementation with scripted admitted clients:
 *
 * - `rule-only` — deterministic cleanup, no provider touched.
 * - `census-advice` — a US-shaped address takes census advice with the
 *   observation's confidence recorded per change.
 * - `nominatim-fallback` — census unavailable, nominatim answers; the
 *   declared census-before-nominatim policy is visible in the call order.
 * - `advisory-unavailable` — both providers exhausted is a DISPOSITION,
 *   never an empty change list pretending nothing needed changing.
 * - `ambiguous` — a field the rules cannot decide reaches the operator.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  NormalizeContactInputSchema,
} from "../../src/domain/contracts/normalization/normalize-contact.js";
import { readContactAdviceTask } from "../../src/stores/normalization/index.js";

const READ_AT = "2026-08-08T12:00:00.000Z";
const RESOLVED_CENSUS = {
  state: "produced",
  value: {
    schemaHash: "ab".repeat(32),
    value: {
      state: "resolved",
      street: "Gilman Drive",
      city: "La Jolla",
      stateCode: "CA",
      zip: "92093",
      matchedAddress: "9500 GILMAN DR, LA JOLLA, CA, 92093",
      confidence: "exact",
    },
  },
};
const UNAVAILABLE = {
  state: "unavailable",
  reason: { code: "rate-exhausted", message: "throttled", retryAt: "2026-08-08T12:01:00.000Z" },
};

function scriptedClient(capability: string, responses: unknown[], calls: string[]) {
  return {
    capability,
    call: () => {
      calls.push(capability);
      const next = responses.shift();
      if (next === undefined) throw new Error(`${capability} exhausted its script`);
      return Promise.resolve(next);
    },
  };
}

async function runAdvice(
  contact: Record<string, string>,
  geocode: boolean,
  scripts: Readonly<{ census?: unknown[]; nominatim?: unknown[] }> = {},
) {
  const calls: string[] = [];
  const ctx = {
    providers: {
      "geocode.census": scriptedClient("geocode.census", scripts.census ?? [], calls),
      "geocode.nominatim": scriptedClient("geocode.nominatim", scripts.nominatim ?? [], calls),
    },
    recordData: () => undefined,
    fail: (code: string, message: string) => { throw new Error(`[normalization] ${code}: ${message}`); },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  };
  const output = await readContactAdviceTask.impl.run({
    input: NormalizeContactInputSchema.parse({ contact, geocode, readAt: READ_AT }),
    ctx: ctx as never,
  });
  return { output, calls };
}

describe("normalization/read-contact-advice scenarios", () => {
  it("normalization/contact/rule-only — deterministic cleanup, no provider touched", async () => {
    const { output, calls } = await runAdvice({
      cellPhone: "(858) 555-1212",
      state: "california",
      postalCode: "920930021",
      relationship: "Wife",
    }, false);
    assert.deepEqual(calls, []);
    assert.equal(output.normalized.cellPhone, "8585551212");
    assert.equal(output.normalized.state, "CA");
    assert.equal(output.normalized.postalCode, "92093-0021");
    assert.equal(output.relationshipCanonical, "Spouse");
    assert.deepEqual(output.disposition, { kind: "complete" });
    assert.deepEqual(
      output.changes.map((change) => [change.field, change.source.kind]),
      [["cellPhone", "rule"], ["state", "rule"], ["postalCode", "rule"], ["relationship", "rule"]],
    );
  });

  it("normalization/contact/census-advice — US-shaped address takes census advice", async () => {
    const { output, calls } = await runAdvice({
      address1: "9500 Gilman Dr",
      city: "la jolla shores",
      state: "CA",
      postalCode: "92037",
    }, true, { census: [RESOLVED_CENSUS] });
    assert.deepEqual(calls, ["geocode.census"]);
    const cityChange = output.changes.find((change) => change.field === "city");
    assert.ok(cityChange !== undefined);
    assert.equal(cityChange.after, "La Jolla");
    assert.deepEqual(cityChange.source, { kind: "census", observedAt: READ_AT, confidence: "exact" });
    assert.equal(output.normalized.postalCode, "92093");
    assert.deepEqual(output.disposition, { kind: "complete" });
  });

  it("normalization/contact/nominatim-fallback — census miss falls to nominatim by declared policy", async () => {
    const { output, calls } = await runAdvice({
      address1: "9500 Gilman Dr",
      state: "CA",
    }, true, { census: [UNAVAILABLE], nominatim: [RESOLVED_CENSUS] });
    assert.deepEqual(calls, ["geocode.census", "geocode.nominatim"]);
    const cityChange = output.changes.find((change) => change.field === "city");
    assert.equal(cityChange, undefined, "no city on the form means no city advice slot");
    assert.deepEqual(output.disposition, { kind: "complete" });
  });

  it("normalization/contact/advisory-unavailable — exhaustion is a disposition, never silence", async () => {
    const { output, calls } = await runAdvice({
      address1: "9500 Gilman Dr",
      state: "CA",
    }, true, { census: [UNAVAILABLE], nominatim: [UNAVAILABLE] });
    assert.deepEqual(calls, ["geocode.census", "geocode.nominatim"]);
    assert.equal(output.disposition.kind, "advisory-unavailable");
    if (output.disposition.kind === "advisory-unavailable") {
      assert.deepEqual(
        output.disposition.unavailable.map((failure) => failure.capability),
        ["geocode.census", "geocode.nominatim"],
      );
    }
  });

  it("normalization/contact/ambiguous — an undecidable field reaches the operator", async () => {
    const { output } = await runAdvice({
      relationship: "acquaintance from work",
      state: "atlantis",
    }, false);
    assert.equal(output.disposition.kind, "ambiguous");
    if (output.disposition.kind === "ambiguous") {
      assert.deepEqual([...output.disposition.fields].sort(), ["relationship", "state"]);
    }
    assert.equal(output.relationshipCanonical, null);
  });
});
