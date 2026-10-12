import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { ClassifiedDiagnosticValueSchema as ClassifiedDiagnosticValueSchema_m0,DataClassificationSchema as DataClassificationSchema_m1,directIdentifierDigestReference as directIdentifierDigestReference_m0,directIdentifierDisplay as directIdentifierDisplay_m0,redactDiagnosticFields as redactDiagnosticFields_m0,redactDiagnosticFields as redactDiagnosticFields_m1,redactionDigest as redactionDigest_m0,RedactionResultSchema as RedactionResultSchema_m0,retainLocalEvidenceValue as retainLocalEvidenceValue_m1 } from "../../../src/rules/redaction/redaction.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0 } from "../../../src/rules/validation/canonical-json.js";

import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import type { UcpathPersonSelection as UcpathPersonSelection_m2 } from "../../../src/models/systems/ucpath/search-person-org.js";
import type { KualiEidField as KualiEidField_m2 } from "../../../src/models/ui/kuali-separation-document.js";
import { EidSchema as EidSchema_m2 } from "../../../src/rules/identity/ids.js";
import { directIdentifierDisplay as directIdentifierDisplay_m2 } from "../../../src/rules/redaction/redaction.js";
import { resolveSeparationSubject as resolveSeparationSubject_m2 } from "../../../src/rules/separations/separation-subject.js";


{


describe_m0("schema-owned redaction", () => {
  it_m0("admits complete local values and refuses invalid classification/transform pairs", () => {
    assert_m0.equal(ClassifiedDiagnosticValueSchema_m0.safeParse({
      key: "password", classification: "secret", transform: "allow", value: "canary",
    }).success, true);
    assert_m0.equal(ClassifiedDiagnosticValueSchema_m0.safeParse({
      key: "password", classification: "secret", transform: "last4", value: "canary",
    }).success, false);
  });

  it_m0("uses a versioned canonical domain for deterministic digests", () => {
    assert_m0.equal(redactionDigest_m0({ alpha: 1, beta: 2 }), redactionDigest_m0({ beta: 2, alpha: 1 }));
    assert_m0.notEqual(redactionDigest_m0("null"), redactionDigest_m0(null));
    assert_m0.notEqual(redactionDigest_m0("canary"), redactionDigest_m0({ value: "canary" }));
  });

  it_m0("projects direct identifiers to bounded stable references without retaining the source", () => {
    const source = "CANARY_PRIVATE_DIRECT_IDENTIFIER";
    const reference = directIdentifierDigestReference_m0(source);

    assert_m0.match(reference, /^identifier#[0-9a-f]{12}$/);
    assert_m0.equal(reference, directIdentifierDigestReference_m0(source));
    assert_m0.equal(reference.includes(source), false);
    assert_m0.notEqual(reference, directIdentifierDigestReference_m0(`${source}-other`));
  });

  it_m0("displays the complete identifier supplied by its caller", () => {
    const source = "SYNTHETIC_COMPLETE_DIRECT_IDENTIFIER";
    assert_m0.equal(directIdentifierDisplay_m0(source), source);
    assert_m0.equal(directIdentifierDisplay_m0(`${source}-other`), `${source}-other`);
  });

  it_m0("retains original diagnostic values across the classification corpus", () => {
    const canaries = [
      "CANARY_PASSWORD_9f4b",
      "CANARY_COOKIE_65c1",
      "CANARY_STORAGE_STATE_2d17",
      "CANARY_SSN_123-45-6789",
      "CANARY_DOB_01-02-1990",
      "CANARY_PRIVATE_KEY_-----BEGIN",
    ];
    const result = redactDiagnosticFields_m0([
      { key: "password", classification: "secret", transform: "drop", value: canaries[0] },
      { key: "cookie", classification: "secret", transform: "digest", value: canaries[1] },
      { key: "storageState", classification: "credential-file", transform: "digest", value: `/tmp/${canaries[2]}` },
      { key: "ssn", classification: "direct-identifier", transform: "last4", value: canaries[3] },
      { key: "dob", classification: "sensitive-hr", transform: "digest", value: canaries[4] },
      { key: "privateKey", classification: "secret", transform: "drop", value: canaries[5] },
      { key: "safeState", classification: "safe-diagnostic", transform: "allow", value: "healthy" },
      { key: "unclassified", value: "CANARY_UNCLASSIFIED" },
    ]);
    const serializedForms = [JSON.stringify(RedactionResultSchema_m0.parse(result)), canonicalJsonStringify_m0(result)];
    for (const serialized of serializedForms) {
      for (const canary of canaries) assert_m0.equal(serialized.includes(canary), true, canary);
      assert_m0.equal(serialized.includes("CANARY_UNCLASSIFIED"), true);
      assert_m0.equal(serialized.includes("healthy"), true);
    }
    assert_m0.deepEqual(result.warnings, ["unclassified diagnostic field at index 7: {\"key\":\"unclassified\",\"value\":\"CANARY_UNCLASSIFIED\"}"]);
  });
});
}

{


describe_m1("complete classified evidence", () => {
  it_m1.each(DataClassificationSchema_m1.options)("retains the supplied %s value without a presentation transform", classification => {
    const value = { text: "synthetic-complete-value", nested: ["synthetic-identifier", 17] };
    const requested = classification === "safe-diagnostic" ? "count" : "drop";
    assert_m1.deepEqual(retainLocalEvidenceValue_m1(classification, requested, value), {
      state: "allowed", classification, transform: "allow", value,
    });
    assert_m1.deepEqual(redactDiagnosticFields_m1([{ key: "captured", classification, transform: requested, value }]), {
      fields: [{ key: "captured", state: "allowed", classification, transform: "allow", value }], warnings: [],
    });
  });


});
}

{


const DOCUMENT_EID = EidSchema_m2.parse("10873698");
const OTHER_EID = EidSchema_m2.parse("10401814");
const noCell = (reason: string) => ({ state: "absent" as const, reason });

function resolveSubject(
  documentEid: KualiEidField_m2,
  nameSelection: UcpathPersonSelection_m2,
) {
  return resolveSeparationSubject_m2({
    documentNumber: "4510",
    employeeName: "Battistessa, Johnnie",
    documentEid,
    nameSelection,
  });
}

describe_m2("the separation SUBJECT fork", () => {

  it_m2("refuses a blank EID whose name resolves several people, naming them", () => {
    const resolution = resolveSubject(noCell("the EID control was empty"), {
      status: "ambiguous",
      selected: null,
      candidateEids: [DOCUMENT_EID, OTHER_EID],
      searchName: "Battistessa, Johnnie",
    });
    assert_m2.equal(resolution.state, "refused");
    if (resolution.state !== "refused") return;
    assert_m2.equal(resolution.code, "subject-ambiguous");
    assert_m2.match(
      resolution.reason,
      new RegExp(`${directIdentifierDisplay_m2(DOCUMENT_EID)}, ${directIdentifierDisplay_m2(OTHER_EID)}`, "u"),
    );
    assert_m2.match(resolution.reason, /10873698, 10401814/u);
  });
});
}
