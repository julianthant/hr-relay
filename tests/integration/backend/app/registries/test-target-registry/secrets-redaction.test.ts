import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { assertNoMigratedEnvironmentKeys, inspectSecret, optionalSecret, requireSecret, requireSecretFile, SECRET_SPECS, retiredTestTargetEnvironmentRefusal } from "../../../../../../src/models/config/secrets.js";
import { TestTargetRegistryDefectError } from "../../../../../../src/backend/app/registries/test-target-registry.js";
import { ClassifiedDiagnosticValueSchema, directIdentifierDigestReference, directIdentifierDisplay, redactDiagnosticFields, redactionDigest, RedactionResultSchema } from "../../../../../../src/rules/redaction/redaction.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { runTestTargetDocumentNumberSmoke } from "../../../../../../scripts/verify/test-target-document-number.js";
import { protectedSecretSource } from "../../../../../support/helpers/protected-secret-source.js";
import { testDataInputSource } from "./test-data-source.js";
import { RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "../../../../../../src/models/config/catalog.js";
import { TestDataLocalConfigError } from "../../../../../../src/models/config/test-data.js";

describe("closed secret access", () => {
  it("resolves only registered names and fails loud at the requested scope", () => {
    const source = protectedSecretSource({ ucpathUserId: "operator" });
    assert.equal(optionalSecret("ucpathUserId", source), "operator");
    assert.equal(requireSecret("ucpathUserId", source), "operator");
    assert.throws(() => requireSecret("ucpathPassword", source), /ucpathPassword/);
  });

  it("reads protected Settings on every use and distinguishes present, missing, and unknown without values", () => {
    let delegate = protectedSecretSource({ ucpathUserId: "first-private-value" });
    let reads = 0;
    const source = { read: () => {
      reads += 1;
      return delegate.read();
    } };
    assert.equal(optionalSecret("ucpathUserId", source), "first-private-value");
    delegate = protectedSecretSource({ ucpathUserId: "second-private-value" });
    assert.equal(optionalSecret("ucpathUserId", source), "second-private-value");
    assert.equal(reads, 2);

    assert.deepEqual(inspectSecret("ucpathPassword", source), {
      name: "ucpathPassword",
      source: "protected-store",
      state: "missing",
      diagnostic: "ucpathPassword is missing from protected-store",
    });
    const privateCorruption = "CANARY_PROTECTED_CORRUPTION";
    delegate = { read: () => ({ privateCorruption }) };
    const unknown = inspectSecret("ucpathPassword", source);
    assert.equal(unknown.state, "unknown");
    assert.equal(JSON.stringify(unknown).includes(privateCorruption), false);
    assert.match(unknown.state === "unknown" ? unknown.diagnostic : "", /could not be resolved from protected-store/u);
  });

  it("keeps protected registry names one-to-one", () => {
    assert.equal(new Set(SECRET_SPECS.map(({ name }) => name)).size, SECRET_SPECS.length);
    assert.equal(SECRET_SPECS.every(({ source }) => source === "protected-store"), true);
    // D341: the two test-target canaries are no longer secrets at all; the
    // protected registry carries only credentials and the timekeeper name.
    for (const retired of ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) {
      assert.equal(SECRET_SPECS.some(({ name }) => (name as string) === retired), false, retired);
    }
  });

  it("admits the available committed canary without printing its document number", async () => {
    const privateValue = "8675309";
    const output: string[] = [];
    let reads = 0;
    const source = testDataInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: privateValue,
    });
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: source,
      readDocumentNumber: (reference, candidateSource) => {
        reads += 1;
        assert.equal(reference.name, "separationsKualiFinalizationCanaryDocumentNumber");
        assert.equal(candidateSource, source);
        return privateValue;
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 0);
    assert.equal(reads, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=present",
      "workflow=separations label=finalization-canary resolution=ready",
    ]);
    assert.equal(output.some((line) => line.includes(privateValue)), false);
  });

  it("fails loud without rows when the committed document-number registry is unavailable", async () => {
    const privateCauseCanary = "CANARY_PRIVATE_COMMITTED_REGISTRY_FAILURE";
    const privateValueCanary = "4537";
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource({
          separationsKualiFinalizationCanaryDocumentNumber: privateValueCanary,
        }),
        loadCommittedReference: () => {
          throw new Error(privateCauseCanary);
        },
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => {
        const diagnostic = String(error);
        assert.match(diagnostic, /committed canary document-number registry unavailable/);
        assert.equal(diagnostic.includes(privateCauseCanary), false);
        assert.equal(diagnostic.includes(privateValueCanary), false);
        return true;
      },
    );
    assert.deepEqual(output, []);
  });

  it("refuses an unconfigured synthetic document number and never attempts the subject", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: testDataInputSource(),
      resolveSubject: () => Promise.resolve("ready"),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=refused",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("refuses a malformed configured document number without disclosing its value", async () => {
    const malformed = "CANARY_PRIVATE_DOCUMENT_NUMBER";
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: { read: () => { throw new TestDataLocalConfigError("config/test-data.local.json is invalid: inputs.separationsKualiFinalizationCanaryDocumentNumber.value"); } },
      resolveSubject: () => Promise.resolve("ready"),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.equal(output.some((line) => line.includes(malformed)), false);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=invalid",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("propagates an unexpected document-number source failure", async () => {
    const cause = new Error("unexpected document-number reader failure");
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource(),
        resolveSubject: () => Promise.resolve("ready"),
        readDocumentNumber: () => {
          throw cause;
        },
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => error === cause,
    );
    assert.deepEqual(output, []);
  });

  it("records a known malformed document-number source as invalid", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: testDataInputSource(),
      resolveSubject: () => Promise.resolve("ready"),
      readDocumentNumber: () => {
        throw new TestDataLocalConfigError("config/test-data.local.json is invalid: inputs.separationsKualiFinalizationCanaryDocumentNumber.value");
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=invalid",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("propagates an unexpected subject resolver failure", async () => {
    const cause = new Error("unexpected subject resolver failure");
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource(),
        resolveSubject: () => Promise.reject(cause),
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => error === cause,
    );
    assert.deepEqual(output, []);
  });

  it("records a known registry defect as defect", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      testInputs: testDataInputSource(),
      resolveSubject: () => Promise.reject(new TestTargetRegistryDefectError("known registry defect")),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=not-attempted",
      "workflow=separations label=finalization-canary resolution=defect",
    ]);
  });

  it("refuses a present number whose composed subject does not resolve ready", async () => {
    // Presence is not admission: the smoke exits 0 only when the composed
    // separations subject resolves through the real registry too, so a blocked
    // or defected resolution cannot read as a green preflight.
    for (const resolution of ["blocked", "defect"] as const) {
      const output: string[] = [];
      const exitCode = await runTestTargetDocumentNumberSmoke({
        testInputs: testDataInputSource({
          separationsKualiFinalizationCanaryDocumentNumber: "4537",
        }),
        resolveSubject: () => Promise.resolve(resolution),
        writeLine: (line) => output.push(line),
      });
      assert.equal(exitCode, 1, resolution);
      assert.deepEqual(output[0], "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "source=test-data-local state=not-attempted");
      assert.deepEqual(output[1], `workflow=separations label=finalization-canary resolution=${resolution}`);
    }
  });

  it("refuses the retired test-target environment keys by name, independently of the catalog (D341)", () => {
    // The canary rows left the catalog; their old `.env` names must still be
    // refused loudly so a stale `.env` cannot silently feed a run.
    assert.deepEqual([...RETIRED_TEST_TARGET_ENVIRONMENT_KEYS], [
      "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER",
      "HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID",
    ]);
    for (const key of RETIRED_TEST_TARGET_ENVIRONMENT_KEYS) {
      const value = "CANARY_RETIRED_ENV_VALUE";
      assert.throws(
        () => assertNoMigratedEnvironmentKeys({ [key]: value }),
        (error: unknown) => {
          const diagnostic = String(error);
          assert.match(diagnostic, new RegExp(`retired test-target environment key ${key} is refused`, "u"));
          assert.match(diagnostic, /config\/test-data\.local\.json \(D341\)/u);
          assert.equal(diagnostic.includes(value), false);
          return true;
        },
        key,
      );
      assert.equal(retiredTestTargetEnvironmentRefusal(key).includes("D341"), true);
    }
  });

  it("does not accept an arbitrary secret-file path", () => {
    // The registered path is pointed at something that provably does not exist.
    // Before D115/D116 resolved `paths.duoCredential` absolutely this test read
    // a RELATIVE path and passed only because nothing was there — so on a
    // machine that had actually enrolled Duo it started finding the real
    // credential and stopped asserting anything. A guard whose outcome depends
    // on the developer's filesystem is not a guard.
    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-10T12:00:00-07:00"))).config;
    const config = {
      ...resolved,
      paths: { ...resolved.paths, duoCredential: "/nonexistent-rebuild-secret-root/duo-webauthn.json" },
    };
    assert.equal(requireSecretFile.length, 2);
    assert.throws(() => requireSecretFile("duoWebauthnCredential", config), /registered rebuild credential path/);
  });
});

describe("schema-owned redaction", () => {
  it("admits complete local values and refuses invalid classification/transform pairs", () => {
    assert.equal(ClassifiedDiagnosticValueSchema.safeParse({
      key: "password", classification: "secret", transform: "allow", value: "canary",
    }).success, true);
    assert.equal(ClassifiedDiagnosticValueSchema.safeParse({
      key: "password", classification: "secret", transform: "last4", value: "canary",
    }).success, false);
  });

  it("uses a versioned canonical domain for deterministic digests", () => {
    assert.equal(redactionDigest({ alpha: 1, beta: 2 }), redactionDigest({ beta: 2, alpha: 1 }));
    assert.notEqual(redactionDigest("null"), redactionDigest(null));
    assert.notEqual(redactionDigest("canary"), redactionDigest({ value: "canary" }));
  });

  it("projects direct identifiers to bounded stable references without retaining the source", () => {
    const source = "CANARY_PRIVATE_DIRECT_IDENTIFIER";
    const reference = directIdentifierDigestReference(source);

    assert.match(reference, /^identifier#[0-9a-f]{12}$/);
    assert.equal(reference, directIdentifierDigestReference(source));
    assert.equal(reference.includes(source), false);
    assert.notEqual(reference, directIdentifierDigestReference(`${source}-other`));
  });

  it("displays the complete identifier supplied by its caller", () => {
    const source = "SYNTHETIC_COMPLETE_DIRECT_IDENTIFIER";
    assert.equal(directIdentifierDisplay(source), source);
    assert.equal(directIdentifierDisplay(`${source}-other`), `${source}-other`);
  });

  it("retains original diagnostic values across the classification corpus", () => {
    const canaries = [
      "CANARY_PASSWORD_9f4b",
      "CANARY_COOKIE_65c1",
      "CANARY_STORAGE_STATE_2d17",
      "CANARY_SSN_123-45-6789",
      "CANARY_DOB_01-02-1990",
      "CANARY_PRIVATE_KEY_-----BEGIN",
    ];
    const result = redactDiagnosticFields([
      { key: "password", classification: "secret", transform: "drop", value: canaries[0] },
      { key: "cookie", classification: "secret", transform: "digest", value: canaries[1] },
      { key: "storageState", classification: "credential-file", transform: "digest", value: `/tmp/${canaries[2]}` },
      { key: "ssn", classification: "direct-identifier", transform: "last4", value: canaries[3] },
      { key: "dob", classification: "sensitive-hr", transform: "digest", value: canaries[4] },
      { key: "privateKey", classification: "secret", transform: "drop", value: canaries[5] },
      { key: "safeState", classification: "safe-diagnostic", transform: "allow", value: "healthy" },
      { key: "unclassified", value: "CANARY_UNCLASSIFIED" },
    ]);
    const serializedForms = [JSON.stringify(RedactionResultSchema.parse(result)), canonicalJsonStringify(result)];
    for (const serialized of serializedForms) {
      for (const canary of canaries) assert.equal(serialized.includes(canary), true, canary);
      assert.equal(serialized.includes("CANARY_UNCLASSIFIED"), true);
      assert.equal(serialized.includes("healthy"), true);
    }
    assert.deepEqual(result.warnings, ["unclassified diagnostic field at index 7: {\"key\":\"unclassified\",\"value\":\"CANARY_UNCLASSIFIED\"}"]);
  });
});
