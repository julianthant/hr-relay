import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import {
  FAILURE_TRIAGE_CLASSIFICATIONS,
  buildAdvisoryFacts,
  buildFailureTriagePrompt,
  advisoryInputDigest,
} from "../../src/domain/trust/advisory.js";
import { LEAKY_EID, LEAKY_NAME, MAXIMAL_FAILURE } from "./fixtures/advisory-fixtures.js";

describe("advisory complete supplied facts", () => {
  it("retains every supplied free-text and person-bearing leaf in the prepared request", () => {
    const prompt = buildFailureTriagePrompt(MAXIMAL_FAILURE);
    const wire = canonicalJsonStringify(prompt);
    for (const supplied of [LEAKY_NAME, LEAKY_EID, "crm.ucsd.edu", "Search results"]) {
      assert.ok(wire.includes(supplied), `prepared request omitted ${supplied}`);
    }
    for (const [key, expected] of [
      ["summary", [MAXIMAL_FAILURE.summary]],
      ["causeChain.summary", MAXIMAL_FAILURE.causeChain.map(cause => cause.summary)],
      ["remediation.message", MAXIMAL_FAILURE.remediation.map(action => action.message)],
      ["page.urlRedacted", [MAXIMAL_FAILURE.page?.urlRedacted]],
      ["page.titleRedacted", [MAXIMAL_FAILURE.page?.titleRedacted]],
      ["subject.observed.displayRedacted", [MAXIMAL_FAILURE.subject?.observed?.displayRedacted]],
    ] as const) {
      const facts = prompt.facts.filter(fact => fact.key === key);
      assert.deepEqual(facts.map(fact => fact.state === "allowed" ? fact.value : undefined), expected, key);
      assert.ok(facts.every(fact => fact.state === "allowed" && fact.transform === "allow"));
      assert.ok(facts.every(fact => fact.classification === (key.startsWith("page.") || key.startsWith("subject.") ? "direct-identifier" : "sensitive-hr")));
    }
    assert.match(prompt.instruction, /complete supplied facts/u);
    assert.doesNotMatch(prompt.instruction, /withheld by policy/u);
    assert.match(prompt.instruction, /do not invent identifiers/u);
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
    for (const entry of FAILURE_TRIAGE_CLASSIFICATIONS) {
      assert.equal(entry.transform, "allow", `${entry.path} must retain its supplied value`);
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
    assert.equal(advisoryInputDigest(first.facts), "10c88a3e88f807dff16fc3868350d9e6bc04b548de90b5a29c43ea53e022c1a0");
    const changed = buildFailureTriagePrompt({ ...MAXIMAL_FAILURE, code: "STALE_SESSION" });
    assert.notEqual(canonicalJsonStringify(first), canonicalJsonStringify(changed));
  });
});
