/**
 * D178 exit arm ①: **redaction happens before the wire, and it is declared.**
 *
 * The assertions are on the EXACT prepared request — the bytes
 * `createGeminiAdvisoryAdapter` would hand to `fetch` — not on a log line and
 * not on the adapter's behaviour. A leak is a fact about the request, so that
 * is what is inspected.
 *
 * `MAXIMAL_FAILURE`'s free-text fields name a real-shaped person and EID on
 * purpose: an arm that redacted a record with nothing to leak would pass
 * whether or not redaction ran at all.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../../src/domain/canonical-json.js";
import {
  FAILURE_TRIAGE_CLASSIFICATIONS,
  buildAdvisoryFacts,
  buildFailureTriagePrompt,
} from "../../../../src/domain/trust/advisory.js";
import { LEAKY_EID, LEAKY_NAME, MAXIMAL_FAILURE } from "../../../fixtures/advisory-prompt-fixtures.js";

describe("advisory redaction — the classified leaf never reaches the prompt", () => {
  it("withholds every free-text and person-bearing leaf from the prepared request", () => {
    const prompt = buildFailureTriagePrompt(MAXIMAL_FAILURE);
    const wire = canonicalJsonStringify(prompt);

    // The whole point, stated four ways: nothing that names the person or
    // their identifier is anywhere in what leaves the process.
    assert.equal(wire.includes(LEAKY_NAME), false, "the failure summary's name is on the wire");
    assert.equal(wire.includes(LEAKY_EID), false, "the failure's EID is on the wire");
    assert.equal(wire.includes("crm.ucsd.edu"), false, "the failure page URL is on the wire");
    assert.equal(wire.includes("Search results"), false, "the failure page title is on the wire");

    // …and the withholding is VISIBLE rather than an omission: the model is
    // told the field exists and was withheld, so it cannot read absence as
    // "there was no summary".
    const byKey = new Map(prompt.facts.map((fact) => [fact.key, fact] as const));
    for (const key of ["summary", "causeChain.summary", "remediation.message"]) {
      const fact = byKey.get(key);
      assert.ok(fact !== undefined, `${key} must appear as a withheld fact`);
      assert.equal(fact.state, "redacted");
      assert.equal(fact.transform, "drop");
    }
    for (const key of ["page.urlRedacted", "page.titleRedacted", "subject.observed.displayRedacted"]) {
      const fact = byKey.get(key);
      assert.ok(fact !== undefined, `${key} must appear as a withheld fact`);
      assert.equal(fact.state, "redacted");
      assert.equal(fact.classification, "direct-identifier");
    }
  });

  it("still carries the closed-vocabulary facts a triage answer needs", () => {
    const prompt = buildFailureTriagePrompt(MAXIMAL_FAILURE);
    const allowed = new Map(
      prompt.facts
        .filter((fact) => fact.state === "allowed")
        .map((fact) => [fact.key, fact.value] as const),
    );
    assert.equal(allowed.get("code"), "SUBJECT_MISMATCH");
    assert.equal(allowed.get("nodeId"), "cross-verify");
    assert.equal(allowed.get("taskId"), "crm/read-person");
    assert.equal(allowed.get("writeState"), "not-attempted");
    assert.equal(allowed.get("page.state"), "crm.person.results");
    assert.equal(allowed.get("action.operation"), "read");
    // The cause chain's CODES survive per element even though its summaries do
    // not — the finer-than-receipt leaf rule earning its keep.
    const causeCodes = prompt.facts
      .filter((fact) => fact.key === "causeChain.code" && fact.state === "allowed")
      .map((fact) => (fact.state === "allowed" ? fact.value : undefined));
    assert.deepEqual(causeCodes, ["SUBJECT_MISMATCH", "STALE_SESSION"]);
  });

  it("refuses an undeclared leaf BY NAME instead of dropping it", () => {
    assert.throws(
      () => buildAdvisoryFacts("failure-triage", { ...MAXIMAL_FAILURE, operatorNote: "call Johnnie" }),
      /no declared advisory classification for failure-triage leaf "operatorNote"/u,
    );
    // The violating fixture in the other direction: the table itself may not
    // declare a pairing the classification forbids.
    for (const entry of FAILURE_TRIAGE_CLASSIFICATIONS) {
      if (entry.classification === "sensitive-hr") {
        assert.notEqual(entry.transform, "allow", `${entry.path} would send a sensitive-hr value verbatim`);
      }
      if (entry.classification === "direct-identifier") {
        assert.ok(
          entry.transform === "drop" || entry.transform === "digest" || entry.transform === "last4",
          `${entry.path} declares a transform direct-identifier forbids`,
        );
      }
    }
  });

  it("declares every leaf the maximal record presents, so a new field fails loudly", () => {
    const declared = new Set(FAILURE_TRIAGE_CLASSIFICATIONS.map((entry) => entry.path));
    const present = new Set(buildAdvisoryFacts("failure-triage", MAXIMAL_FAILURE).map((fact) => fact.key));
    for (const path of present) {
      assert.ok(declared.has(path), `${path} was produced without a declaration`);
    }
    // Every declaration is exercised by the maximal record: a table entry no
    // record can present is a rule nothing proves.
    for (const path of declared) {
      assert.ok(present.has(path), `${path} is declared but the maximal failure never presents it`);
    }
  });

  it("digests exactly the bytes that leave, so the recorded input digest is checkable", () => {
    const first = buildFailureTriagePrompt(MAXIMAL_FAILURE);
    const second = buildFailureTriagePrompt({ ...MAXIMAL_FAILURE });
    assert.equal(canonicalJsonStringify(first), canonicalJsonStringify(second));
    const changed = buildFailureTriagePrompt({ ...MAXIMAL_FAILURE, code: "STALE_SESSION" });
    assert.notEqual(canonicalJsonStringify(first), canonicalJsonStringify(changed));
  });
});
