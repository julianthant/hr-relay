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
 * - `ai-advice` — D178: an ambiguous SAFE-DIAGNOSTIC field is asked about and
 *   the model's answer becomes an `ai`-sourced change with its own confidence.
 * - `ai-withheld-field` — the same run with `relationship` ambiguous: its
 *   `sensitive-hr` classification forbids the `allow` transform, so it is
 *   never on the wire and stays `ambiguous` for the operator.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import {
  NormalizeContactInputSchema,
} from "../../src/domain/contracts/normalization/normalize-contact.js";
import {
  ADVISORY_ANSWER_SCHEMA_HASH,
  AdvisoryPromptSchema,
  CONTACT_ADVICE_SCHEMA_HASH,
} from "../../src/domain/trust/advisory.js";
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

function scriptedClient(
  capability: string,
  responses: unknown[],
  calls: string[],
  sent: unknown[] = [],
) {
  return {
    capability,
    call: (payload: unknown) => {
      calls.push(capability);
      sent.push(payload);
      const next = responses.shift();
      if (next === undefined) throw new Error(`${capability} exhausted its script`);
      return Promise.resolve(next);
    },
  };
}

/** What an `ai.advisory` adapter produces: the envelope, verbatim answer inside. */
function aiProduced(answer: unknown) {
  return {
    state: "produced",
    value: {
      schemaHash: ADVISORY_ANSWER_SCHEMA_HASH,
      value: {
        surface: "contact-normalization",
        provider: "gemini",
        model: "gemini-3-flash-preview",
        answerSchemaFingerprint: CONTACT_ADVICE_SCHEMA_HASH,
        answer,
      },
    },
  };
}

async function runAdvice(
  contact: Record<string, string>,
  geocode: boolean,
  scripts: Readonly<{ census?: unknown[]; nominatim?: unknown[]; ai?: unknown[] }> = {},
) {
  const calls: string[] = [];
  const aiSent: unknown[] = [];
  const ctx = {
    providers: {
      "geocode.census": scriptedClient("geocode.census", scripts.census ?? [], calls),
      "geocode.nominatim": scriptedClient("geocode.nominatim", scripts.nominatim ?? [], calls),
      "ai.advisory": scriptedClient("ai.advisory", scripts.ai ?? [], calls, aiSent),
    },
    recordData: () => undefined,
    fail: (code: string, message: string) => { throw new Error(`[normalization] ${code}: ${message}`); },
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  };
  const output = await readContactAdviceTask.impl.run({
    input: NormalizeContactInputSchema.parse({
      contact,
      geocode,
      ai: scripts.ai !== undefined,
      readAt: READ_AT,
    }),
    ctx: ctx as never,
  });
  return { output, calls, aiSent };
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

  it("normalization/contact/ai-advice — an askable ambiguous field becomes an ai-sourced change", async () => {
    const { output, calls, aiSent } = await runAdvice({
      state: "Calif.",
    }, false, { ai: [aiProduced({ fields: [{ field: "state", value: "CA", confidence: 0.92 }] })] });
    assert.deepEqual(calls, ["ai.advisory"]);

    // The prompt that LEFT the process: exactly the askable field, redacted
    // under its own canonical classification, with the closed answer schema.
    const prompt = AdvisoryPromptSchema.parse(
      (aiSent[0] as { value: unknown }).value,
    );
    assert.equal(prompt.surface, "contact-normalization");
    assert.deepEqual(prompt.facts.map((fact) => fact.key), ["state"]);

    const change = output.changes.find((candidate) => candidate.field === "state");
    assert.ok(change !== undefined);
    assert.deepEqual(change.source, {
      kind: "ai",
      provider: "gemini",
      model: "gemini-3-flash-preview",
      confidence: 0.92,
    });
    assert.equal(output.normalized.state, "CA");
    assert.deepEqual(output.disposition, { kind: "complete" });
  });

  it("normalization/contact/ai-withheld-field — a sensitive-hr field never reaches the wire", async () => {
    const { output, aiSent } = await runAdvice({
      relationship: "acquaintance from work",
      state: "Calif.",
    }, false, { ai: [aiProduced({ fields: [{ field: "state", value: "CA", confidence: 0.9 }] })] });

    const prompt = AdvisoryPromptSchema.parse((aiSent[0] as { value: unknown }).value);
    // `relationship` is `sensitive-hr`: it is not askable, so it is not asked.
    assert.deepEqual(prompt.facts.map((fact) => fact.key), ["state"]);
    const wire = canonicalJsonStringify(aiSent[0]);
    assert.equal(wire.includes("acquaintance"), false, "the withheld value must not appear anywhere in the request");
    assert.equal(wire.includes("work"), false);

    // And it stays with the operator rather than being guessed at.
    assert.equal(output.disposition.kind, "ambiguous");
    if (output.disposition.kind === "ambiguous") {
      assert.deepEqual(output.disposition.fields, ["relationship"]);
    }
  });
});
