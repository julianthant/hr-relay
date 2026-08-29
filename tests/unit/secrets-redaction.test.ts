import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  optionalSecret,
  optionalSecretFamily,
  optionalTestTargetEidSecret,
  optionalTestTargetSecret,
  inspectSecret,
  requireSecret,
  requireSecretFamily,
  requireSecretFile,
  SECRET_FAMILY_SPECS,
  SECRET_SPECS,
  TEST_TARGET_EID_SECRET_SPECS,
  TEST_TARGET_SECRET_SPECS,
  TestTargetEidSecretSpecSchema,
  TestTargetSecretReferenceSchema,
  validateDescriptorSecrets,
} from "../../src/domain/secrets.js";
import {
  ClassifiedDiagnosticValueSchema,
  redactDiagnosticFields,
  redactionDigest,
  RedactionResultSchema,
} from "../../src/domain/redaction.js";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { runTestTargetPersonSecretsSmoke } from "../../scripts/smoke-test-target-person-secrets.js";

describe("closed secret access", () => {
  it("resolves only registered names and fails loud at the requested scope", () => {
    const env = { UCPATH_USER_ID: " operator ", GEMINI_API_KEY: "key-one", GEMINI_API_KEY2: "key-two" };
    assert.equal(optionalSecret("ucpathUserId", env), "operator");
    assert.equal(requireSecret("ucpathUserId", env), "operator");
    assert.deepEqual(optionalSecretFamily("geminiApiKeys", env), ["key-one", "key-two"]);
    assert.deepEqual(requireSecretFamily("geminiApiKeys", env), ["key-one", "key-two"]);
    assert.throws(() => requireSecret("ucpathPassword", env), /UCPATH_PASSWORD/);
    assert.throws(() => validateDescriptorSecrets(["ucpathUserId", "ucpathPassword"], [], env), /ucpathPassword/);
    assert.throws(() => requireSecretFamily("groqApiKeys", env), /GROQ_API_KEY/);
  });

  it("resolves the registered local ngrok source without exposing its value in preflight diagnostics", () => {
    const access = {
      homeDirectory: () => "/operator",
      stat: () => ({ isFile: () => true, mode: 0o600, size: 48 }),
      readText: () => "version: 3\nauthtoken: local-test-token\n",
      readBytes: () => Buffer.from("unused"),
    };
    assert.equal(requireSecret("ngrokCredential", {}, access), "local-test-token");
    assert.deepEqual(inspectSecret("ngrokCredential", {}, access), {
      name: "ngrokCredential",
      source: "local-ngrok-config",
      state: "present",
    });
    assert.doesNotThrow(() => validateDescriptorSecrets(["ngrokCredential"], [], {}, access));
  });

  it("fails descriptor preflight with explicit missing and unknown local-source diagnostics", () => {
    const missing = {
      homeDirectory: () => "/operator",
      stat: () => ({ isFile: () => true, mode: 0o600, size: 12 }),
      readText: () => "version: 3\n",
      readBytes: () => Buffer.from("unused"),
    };
    assert.throws(
      () => validateDescriptorSecrets(["ngrokCredential"], [], {}, missing),
      /ngrokCredential \[missing:.*local-ngrok-config/,
    );

    const unreadable = {
      ...missing,
      readText: () => {
        throw new Error("fixture read denied");
      },
    };
    const availability = inspectSecret("ngrokCredential", {}, unreadable);
    assert.equal(availability.state, "unknown");
    assert.equal(JSON.stringify(availability).includes("local-test-token"), false);
    assert.throws(
      () => validateDescriptorSecrets(["ngrokCredential"], [], {}, unreadable),
      /ngrokCredential \[unknown:.*could not be resolved/,
    );
  });

  it("keeps registry names and environment sources one-to-one", () => {
    assert.equal(new Set(SECRET_SPECS.map(({ name }) => name)).size, SECRET_SPECS.length);
    const environmentSpecs = SECRET_SPECS.filter((spec) => spec.source === "environment");
    assert.equal(new Set(environmentSpecs.map(({ env }) => env)).size, environmentSpecs.length);
    assert.equal(new Set(SECRET_FAMILY_SPECS.map(({ name }) => name)).size, SECRET_FAMILY_SPECS.length);
    assert.equal(new Set(SECRET_FAMILY_SPECS.map(({ envPrefix }) => envPrefix)).size, SECRET_FAMILY_SPECS.length);
    assert.equal(
      new Set(TEST_TARGET_SECRET_SPECS.map(({ name }) => name)).size,
      TEST_TARGET_SECRET_SPECS.length,
    );
    assert.equal(
      new Set(TEST_TARGET_SECRET_SPECS.map(({ env }) => env)).size,
      TEST_TARGET_SECRET_SPECS.length,
    );
    assert.equal(TEST_TARGET_SECRET_SPECS.length, 3);
  });

  it("reads all registered test-target person values through their closed names", () => {
    const eidEnv = "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID";
    const employeeEnv = "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME";
    const timekeeperEnv = "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME";
    const env = {
      [eidEnv]: " 10800000 ",
      [employeeEnv]: "Person, Synthetic",
      [timekeeperEnv]: "Synthetic Timekeeper",
    };
    assert.equal(optionalTestTargetSecret(
      "separationsKualiFinalizationCanaryEid",
      env,
    ), "10800000");
    assert.equal(optionalTestTargetSecret(
      "separationsKualiFinalizationCanaryEmployeeName",
      env,
    ), "Person, Synthetic");
    assert.equal(optionalTestTargetSecret(
      "separationsKualiFinalizationCanaryTimekeeperName",
      env,
    ), "Synthetic Timekeeper");
    for (const { name } of TEST_TARGET_SECRET_SPECS) {
      assert.equal(optionalTestTargetSecret(name, {}), undefined);
    }
  });

  it("keeps EID compatibility APIs EID-narrow", () => {
    assert.deepEqual(TEST_TARGET_EID_SECRET_SPECS.map(({ name }) => name), [
      "separationsKualiFinalizationCanaryEid",
    ]);
    const eidSpec = TEST_TARGET_EID_SECRET_SPECS[0];
    if (eidSpec === undefined) throw new Error("the test-target secret registry has no EID spec");
    const displayNameSpec = TEST_TARGET_SECRET_SPECS.find(
      ({ valueKind }) => valueKind === "employee-display-name",
    );
    if (displayNameSpec === undefined) {
      throw new Error("the test-target secret registry has no employee display-name spec");
    }

    assert.equal(TestTargetEidSecretSpecSchema.safeParse(eidSpec).success, true);
    assert.equal(TestTargetEidSecretSpecSchema.safeParse(displayNameSpec).success, false);
    assert.equal(optionalTestTargetEidSecret(eidSpec.name, { [eidSpec.env]: " 10800000 " }), "10800000");
  });

  it("preflights the committed person-secret references without exposing their values", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetPersonSecretsSmoke({
      env: {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "10800000",
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: "Person, Smoke Canary",
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: "Smoke Timekeeper",
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(output, [
      "field=employeeName reference=separationsKualiFinalizationCanaryEmployeeName "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME state=present",
      "field=emplId reference=separationsKualiFinalizationCanaryEid "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID state=present",
      "field=timekeeperName reference=separationsKualiFinalizationCanaryTimekeeperName "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME state=present",
    ]);
  });

  it("refuses a missing committed person secret without disclosing an absence clue", async () => {
    const output: string[] = [];
    const exitCode = await runTestTargetPersonSecretsSmoke({
      env: {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: "Person, Smoke Canary",
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: "Smoke Timekeeper",
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=employeeName reference=separationsKualiFinalizationCanaryEmployeeName "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME state=present",
      "field=emplId reference=separationsKualiFinalizationCanaryEid "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID state=refused",
      "field=timekeeperName reference=separationsKualiFinalizationCanaryTimekeeperName "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME state=present",
    ]);
  });

  it("refuses a malformed committed person secret without disclosing its value", async () => {
    const malformed = " CANARY_PRIVATE_EMPLOYEE ";
    const output: string[] = [];
    const exitCode = await runTestTargetPersonSecretsSmoke({
      env: {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "10800000",
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: malformed,
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: "Smoke Timekeeper",
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.equal(output.some((line) => line.includes(malformed)), false);
    assert.deepEqual(output, [
      "field=employeeName reference=separationsKualiFinalizationCanaryEmployeeName "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME state=refused",
      "field=emplId reference=separationsKualiFinalizationCanaryEid "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID state=present",
      "field=timekeeperName reference=separationsKualiFinalizationCanaryTimekeeperName "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME state=present",
    ]);
  });

  it("keeps every invalid test-target person value out of its refusal", () => {
    const invalid = [
      {
        name: "separationsKualiFinalizationCanaryEid",
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
        value: "CANARY_DIRECT_IDENTIFIER",
      },
      {
        name: "separationsKualiFinalizationCanaryEmployeeName",
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME",
        value: " CANARY_EMPLOYEE_NAME ",
      },
      {
        name: "separationsKualiFinalizationCanaryTimekeeperName",
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME",
        value: "CANARY_TIMEKEEPER_é",
      },
    ] as const;

    for (const candidate of invalid) {
      assert.throws(
        () => optionalTestTargetSecret(candidate.name, { [candidate.env]: candidate.value }),
        (error: unknown) => {
          assert.match(String(error), new RegExp(`${candidate.name}.*registered environment source ${candidate.env}`));
          assert.equal(String(error).includes(candidate.value), false);
          return true;
        },
      );
    }
  });

  it("rejects arbitrary and mismatched test-target environment references", () => {
    assert.equal(TestTargetSecretReferenceSchema.safeParse({
      name: "separationsKualiFinalizationCanaryEmployeeName",
      env: "HRAUTO_ARBITRARY_PERSON_VALUE",
    }).success, false);
    assert.equal(TestTargetSecretReferenceSchema.safeParse({
      name: "separationsKualiFinalizationCanaryEid",
      env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME",
    }).success, false);
  });

  it("does not accept an arbitrary secret-file path", () => {
    // The registered path is pointed at something that provably does not exist.
    // Before D115/D116 resolved `paths.duoCredential` absolutely this test read
    // a RELATIVE path and passed only because nothing was there — so on a
    // machine that had actually enrolled Duo it started finding the real
    // credential and stopped asserting anything. A guard whose outcome depends
    // on the developer's filesystem is not a guard.
    const config = resolveConfig(
      {},
      { paths: { duoCredential: "/nonexistent-rebuild-secret-root/duo-webauthn.json" } },
      manualClock(new Date("2026-08-10T12:00:00-07:00")),
    );
    assert.equal(requireSecretFile.length, 2);
    assert.throws(() => requireSecretFile("duoWebauthnCredential", config), /registered rebuild credential path/);
  });
});

describe("schema-owned redaction", () => {
  it("rejects unsafe classification/transform combinations", () => {
    assert.equal(ClassifiedDiagnosticValueSchema.safeParse({
      key: "password",
      classification: "secret",
      transform: "allow",
      value: "canary",
    }).success, false);
  });

  it("uses a versioned canonical domain for deterministic digests", () => {
    assert.equal(redactionDigest({ alpha: 1, beta: 2 }), redactionDigest({ beta: 2, alpha: 1 }));
    assert.notEqual(redactionDigest("null"), redactionDigest(null));
    assert.notEqual(redactionDigest("canary"), redactionDigest({ value: "canary" }));
  });

  it("never serializes restricted canaries across the classification corpus", () => {
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
      for (const canary of canaries) assert.equal(serialized.includes(canary), false, canary);
      assert.equal(serialized.includes("CANARY_UNCLASSIFIED"), false);
      assert.equal(serialized.includes("healthy"), true);
    }
    assert.deepEqual(result.warnings, ["unclassified diagnostic field at index 7 dropped"]);
  });
});
