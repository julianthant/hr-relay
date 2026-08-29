import assert from "node:assert/strict";
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  admitLocalEnvironmentFile,
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
  directIdentifierDigestReference,
  redactDiagnosticFields,
  redactionDigest,
  RedactionResultSchema,
} from "../../src/domain/redaction.js";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { runTestTargetPersonSecretsSmoke } from "../../scripts/smoke-test-target-person-secrets.js";

describe("closed secret access", () => {
  it("admits parsed local environment bytes without overriding an explicit parent value", () => {
    const env: NodeJS.ProcessEnv = { HRAUTO_PARENT_SETTING: "parent" };
    const descriptor = 17;

    admitLocalEnvironmentFile(env, {
      currentDirectory: () => "/tmp/local-environment-fixture",
      open: () => descriptor,
      inspectDescriptor: (candidate) => {
        assert.equal(candidate, descriptor);
        return { isFile: () => true, mode: 0o600, size: 67 };
      },
      readBytes: (candidate) => {
        assert.equal(candidate, descriptor);
        return Buffer.from([
          "HRAUTO_BOOTSTRAP_SETTING=from-file",
          "HRAUTO_PARENT_SETTING=from-file",
          "",
        ].join("\n"));
      },
      close: (candidate) => assert.equal(candidate, descriptor),
    });

    assert.equal(env.HRAUTO_BOOTSTRAP_SETTING, "from-file");
    assert.equal(env.HRAUTO_PARENT_SETTING, "parent");
  });

  it("validates admission metadata on the opened descriptor before reading bytes", () => {
    let read = false;
    let closed = false;
    const env: NodeJS.ProcessEnv = {};

    assert.throws(
      () => admitLocalEnvironmentFile(env, {
        currentDirectory: () => "/tmp/local-environment-fixture",
        open: () => 23,
        inspectDescriptor: () => ({ isFile: () => true, mode: 0o640, size: 48 }),
        readBytes: () => {
          read = true;
          return Buffer.from("HRAUTO_UNSAFE_SETTING=present\n");
        },
        close: () => {
          closed = true;
        },
      }),
      /local environment file \.env permissions must be 0600 or stricter/,
    );
    assert.equal(read, false);
    assert.equal(closed, true);
    assert.equal(env.HRAUTO_UNSAFE_SETTING, undefined);
  });

  it("refuses a local environment path that is a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-secure-env-"));
    try {
      writeFileSync(join(root, "target-env"), "HRAUTO_SYMLINK_CANARY=present\n", { mode: 0o600 });
      symlinkSync("target-env", join(root, ".env"));
      const env: NodeJS.ProcessEnv = {};

      assert.throws(
        () => admitLocalEnvironmentFile(env, {
          currentDirectory: () => root,
          open: openSync,
          inspectDescriptor: fstatSync,
          readBytes: (descriptor) => readFileSync(descriptor),
          close: closeSync,
        }),
        /local environment file \.env is unavailable/,
      );
      assert.equal(env.HRAUTO_SYMLINK_CANARY, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a group-readable local environment file without exposing its private path", () => {
    const privatePathCanary = "CANARY_PRIVATE_ENV_DIRECTORY";
    let closed = false;

    assert.throws(
      () => admitLocalEnvironmentFile({}, {
        currentDirectory: () => `/tmp/${privatePathCanary}`,
        open: () => 31,
        inspectDescriptor: () => ({ isFile: () => true, mode: 0o640, size: 128 }),
        readBytes: () => Buffer.from("HRAUTO_UNSAFE_SETTING=present\n"),
        close: () => {
          closed = true;
        },
      }),
      (error: unknown) => {
        assert.match(String(error), /local environment file \.env permissions must be 0600 or stricter/);
        assert.equal(String(error).includes(privatePathCanary), false);
        return true;
      },
    );
    assert.equal(closed, true);
  });

  it("refuses a local environment source that is not an exact regular file", () => {
    assert.throws(
      () => admitLocalEnvironmentFile({}, {
        currentDirectory: () => "/tmp/local-environment-fixture",
        open: () => 37,
        inspectDescriptor: () => ({ isFile: () => false, mode: 0o600, size: 128 }),
        readBytes: () => Buffer.from("HRAUTO_UNSAFE_SETTING=present\n"),
        close: () => undefined,
      }),
      /local environment file \.env is not a regular file/,
    );
  });

  it("refuses a local environment file above the bounded secret-file size", () => {
    assert.throws(
      () => admitLocalEnvironmentFile({}, {
        currentDirectory: () => "/tmp/local-environment-fixture",
        open: () => 41,
        inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: 64_001 }),
        readBytes: () => Buffer.from("HRAUTO_UNSAFE_SETTING=present\n"),
        close: () => undefined,
      }),
      /local environment file \.env exceeds its registered size limit/,
    );
  });

  it("fails loud for unavailable local environment metadata without retaining its private cause", () => {
    const privateCauseCanary = "CANARY_PRIVATE_ENV_SOURCE_FAILURE";

    assert.throws(
      () => admitLocalEnvironmentFile({}, {
        currentDirectory: () => "/tmp/local-environment-fixture",
        open: () => {
          throw new Error(privateCauseCanary);
        },
        inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: 128 }),
        readBytes: () => Buffer.from("HRAUTO_UNSAFE_SETTING=present\n"),
        close: () => undefined,
      }),
      (error: unknown) => {
        assert.match(String(error), /local environment file \.env is unavailable/);
        const cause = error instanceof Error ? String(error.cause) : "";
        assert.equal(`${String(error)} ${cause}`.includes(privateCauseCanary), false);
        return true;
      },
    );
  });

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
    const privateValues = ["10800000", "Person, Smoke Canary", "Smoke Timekeeper"];
    const output: string[] = [];
    const exitCode = await runTestTargetPersonSecretsSmoke({
      env: {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: privateValues[0],
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: privateValues[1],
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: privateValues[2],
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
    for (const privateValue of privateValues) {
      assert.equal(output.some((line) => line.includes(privateValue)), false);
    }
  });

  it("fails loud without rows when the committed person-secret registry is unavailable", async () => {
    const privateCauseCanary = "CANARY_PRIVATE_COMMITTED_REGISTRY_FAILURE";
    const privateValueCanary = "CANARY_PRIVATE_PERSON_VALUE";
    const output: string[] = [];

    await assert.rejects(
      runTestTargetPersonSecretsSmoke({
        env: {
          HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "10800000",
          HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: privateValueCanary,
          HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: "Smoke Timekeeper",
        },
        loadCommittedRows: async () => {
          throw new Error(privateCauseCanary);
        },
        writeLine: (line) => output.push(line),
      }),
      (error: unknown) => {
        const diagnostic = String(error);
        assert.match(diagnostic, /committed person-secret registry unavailable/);
        assert.equal(diagnostic.includes(privateCauseCanary), false);
        assert.equal(diagnostic.includes(privateValueCanary), false);
        return true;
      },
    );
    assert.deepEqual(output, []);
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

  it("projects direct identifiers to bounded stable references without retaining the source", () => {
    const source = "CANARY_PRIVATE_DIRECT_IDENTIFIER";
    const reference = directIdentifierDigestReference(source);

    assert.match(reference, /^identifier#[0-9a-f]{12}$/);
    assert.equal(reference, directIdentifierDigestReference(source));
    assert.equal(reference.includes(source), false);
    assert.notEqual(reference, directIdentifierDigestReference(`${source}-other`));
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
