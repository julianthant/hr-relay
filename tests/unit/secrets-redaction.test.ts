import { hostConfigFacts } from "../../src/domain/config/host-display.js";
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
  optionalTestTargetSecret,
  requireSecret,
  requireSecretFamily,
  requireSecretFile,
  SecretSourceError,
  SECRET_FAMILY_SPECS,
  SECRET_SPECS,
  TEST_TARGET_SECRET_SPECS,
  TestTargetSecretReferenceSchema,
  TestTargetSecretSpecSchema,
  validateDescriptorSecrets,
} from "../../src/domain/secrets.js";
import { TestTargetRegistryDefectError } from "../../src/control/test-target-registry.js";
import {
  ClassifiedDiagnosticValueSchema,
  directIdentifierDigestReference,
  redactDiagnosticFields,
  redactionDigest,
  RedactionResultSchema,
} from "../../src/domain/redaction.js";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../src/domain/config/resolve.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { runTestTargetDocumentNumberSmoke } from "../../scripts/smoke-test-target-document-number.js";

describe("closed secret access", () => {
  it("admits parsed local environment bytes without overriding an explicit parent value", () => {
    const env: NodeJS.ProcessEnv = { HRAUTO_PARENT_SETTING: "parent" };
    const descriptor = 17;

    admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", env, {
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

  it("rejects every malformed local environment line before applying any binding", () => {
    const malformed = [
      ["ignored junk", "HRAUTO_FIRST=accepted\nthis is junk\nHRAUTO_LAST=not-applied\n"],
      ["unterminated single quote", "HRAUTO_FIRST=accepted\nHRAUTO_BROKEN='private\n"],
      ["unterminated double quote", "HRAUTO_FIRST=accepted\nHRAUTO_BROKEN=\"private\n"],
      ["unterminated backtick quote", "HRAUTO_FIRST=accepted\nHRAUTO_BROKEN=`private\n"],
      ["duplicate key", "HRAUTO_DUPLICATE=first\nHRAUTO_DUPLICATE=second\n"],
      ["invalid key", "hrauto_lowercase=private\n"],
      ["export assignment", "export HRAUTO_EXPORTED=private\n"],
      ["ambiguous assignment", "HRAUTO_AMBIGUOUS=first=private\n"],
    ] as const;

    for (const [label, content] of malformed) {
      const env: NodeJS.ProcessEnv = {};
      assert.throws(
        () => admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", env, {
          open: () => 19,
          inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: content.length }),
          readBytes: () => Buffer.from(content),
          close: () => undefined,
        }),
        (error: unknown) => {
          assert.match(String(error), /local environment file \.env has invalid syntax at line \d+/u, label);
          assert.equal(String(error).includes("private"), false, label);
          return true;
        },
      );
      assert.deepEqual(env, {}, `${label} applied a binding before the whole file was admitted`);
    }
  });

  it("admits the complete supported local environment grammar byte-for-byte", () => {
    const env: NodeJS.ProcessEnv = {};
    const content = [
      "# leading comment\r",
      "\r",
      "HRAUTO_PLAIN=plain value\r",
      "HRAUTO_SINGLE='single # value = retained'\r",
      "HRAUTO_DOUBLE=\"double # value = retained\" # trailing comment\r",
      "HRAUTO_BACKTICK=`backtick # value = retained`\r",
      "HRAUTO_MULTILINE=\"first line\r",
      "second # line = retained\"\r",
      "  # indented comment\r",
      "",
    ].join("\n");

    admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", env, {
      open: () => 21,
      inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: Buffer.byteLength(content) }),
      readBytes: () => Buffer.from(content),
      close: () => undefined,
    });

    assert.deepEqual(env, {
      HRAUTO_PLAIN: "plain value",
      HRAUTO_SINGLE: "single # value = retained",
      HRAUTO_DOUBLE: "double # value = retained",
      HRAUTO_BACKTICK: "backtick # value = retained",
      HRAUTO_MULTILINE: "first line\nsecond # line = retained",
    });
  });

  it("validates admission metadata on the opened descriptor before reading bytes", () => {
    let read = false;
    let closed = false;
    const env: NodeJS.ProcessEnv = {};

    assert.throws(
      () => admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", env, {
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
        () => admitLocalEnvironmentFile(join(root, ".env"), env, {
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
      () => admitLocalEnvironmentFile(`/tmp/${privatePathCanary}/.env`, {}, {
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
      () => admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", {}, {
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
      () => admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", {}, {
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
      () => admitLocalEnvironmentFile("/tmp/local-environment-fixture/.env", {}, {
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

  it("preserves the admission failure before a simultaneous descriptor-close failure", () => {
    assert.throws(
      () => admitLocalEnvironmentFile("/repo/.env", {}, {
        open: () => 43,
        inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: 1 }),
        readBytes: () => Buffer.from([0xff]),
        close: () => {
          throw new Error("synthetic close failure");
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof AggregateError, true);
        if (!(error instanceof AggregateError)) return false;
        assert.deepEqual(
          error.errors.map((failure: unknown) => String(failure)),
          [
            "SecretSourceError: local environment file .env could not be read and parsed",
            "SecretSourceError: local environment file .env descriptor could not be closed",
          ],
        );
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
    // D300: the canary's Kuali document number crosses the closed boundary; the
    // three person references D286 registered are retired, not re-pointed.
    // D318 adds exactly one more: the person-lookup live-read canary's EID.
    assert.deepEqual(TEST_TARGET_SECRET_SPECS.map(({ name, valueKind }) => `${name}:${valueKind}`), [
      "separationsKualiFinalizationCanaryDocumentNumber:kuali-document-number",
      "personLookupCanaryEid:ucpath-eid",
    ]);
  });

  it("reads the ONE registered test-target document number through its closed name", () => {
    const documentNumberEnv = "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER";
    assert.equal(optionalTestTargetSecret(
      "separationsKualiFinalizationCanaryDocumentNumber",
      { [documentNumberEnv]: " 4537 " },
    ), "4537");
    // Unset and blank are the operator's truthful "not configured", never a
    // substituted default: the caller receives `undefined` and blocks by key.
    for (const env of [{}, { [documentNumberEnv]: "" }, { [documentNumberEnv]: "   " }]) {
      assert.equal(optionalTestTargetSecret("separationsKualiFinalizationCanaryDocumentNumber", env), undefined);
    }
    for (const { name } of TEST_TARGET_SECRET_SPECS) {
      assert.equal(optionalTestTargetSecret(name, {}), undefined);
    }
  });

  it("keeps the registered test-target spec a DOCUMENT NUMBER, never a person value", () => {
    const [spec] = TEST_TARGET_SECRET_SPECS;
    if (spec === undefined) throw new Error("the test-target secret registry has no spec");
    assert.deepEqual({ ...spec }, {
      name: "separationsKualiFinalizationCanaryDocumentNumber",
      env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER",
      valueKind: "kuali-document-number",
      classification: "direct-identifier",
    });
    assert.equal(TestTargetSecretSpecSchema.safeParse(spec).success, true);
    // A person-shaped spec cannot be smuggled back in under the same name: the
    // value kind is a literal, and a document number is not a person.
    assert.equal(TestTargetSecretSpecSchema.safeParse({
      ...spec,
      valueKind: "employee-display-name",
    }).success, false);
  });

  it("admits the available committed canary without printing its document number", async () => {
    const privateValue = "8675309";
    const output: string[] = [];
    let reads = 0;
    const exitCode = await runTestTargetDocumentNumberSmoke({
      env: { HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: privateValue },
      readDocumentNumber: (reference, env) => {
        reads += 1;
        assert.equal(reference.name, "separationsKualiFinalizationCanaryDocumentNumber");
        assert.equal(env?.HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER, privateValue);
        return privateValue;
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 0);
    assert.equal(reads, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER state=present",
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
        env: { HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: privateValueCanary },
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
      env: {},
      resolveSubject: () => Promise.resolve("ready"),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER state=refused",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("refuses a malformed configured document number without disclosing its value", async () => {
    const malformed = "CANARY_PRIVATE_DOCUMENT_NUMBER";
    const output: string[] = [];
    const exitCode = await runTestTargetDocumentNumberSmoke({
      env: { HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: malformed },
      resolveSubject: () => Promise.resolve("ready"),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.equal(output.some((line) => line.includes(malformed)), false);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER state=invalid",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("propagates an unexpected document-number source failure", async () => {
    const cause = new Error("unexpected document-number reader failure");
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
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
      resolveSubject: () => Promise.resolve("ready"),
      readDocumentNumber: () => {
        throw new SecretSourceError("registered document number is malformed");
      },
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER state=invalid",
      "workflow=separations label=finalization-canary resolution=not-attempted",
    ]);
  });

  it("propagates an unexpected subject resolver failure", async () => {
    const cause = new Error("unexpected subject resolver failure");
    const output: string[] = [];

    await assert.rejects(
      runTestTargetDocumentNumberSmoke({
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
      resolveSubject: () => Promise.reject(new TestTargetRegistryDefectError("known registry defect")),
      writeLine: (line) => output.push(line),
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output, [
      "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER state=not-attempted",
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
        env: { HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: "4537" },
        resolveSubject: () => Promise.resolve(resolution),
        writeLine: (line) => output.push(line),
      });
      assert.equal(exitCode, 1, resolution);
      assert.deepEqual(output[0], "field=documentNumber reference=separationsKualiFinalizationCanaryDocumentNumber "
        + "env=HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER state=not-attempted");
      assert.deepEqual(output[1], `workflow=separations label=finalization-canary resolution=${resolution}`);
    }
  });

  it("keeps every invalid test-target document number out of its refusal", () => {
    const name = "separationsKualiFinalizationCanaryDocumentNumber";
    const env = "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER";
    // The judge is `KualiDocumentNumberSchema` — the same 3-8 digit rule the
    // separations start box applies — so what survives is exactly what an
    // operator could have typed, and a person value never can be.
    for (const value of ["abc", "1", "123456789", "CANARY_DIRECT_IDENTIFIER", "Person, Private"]) {
      assert.throws(
        () => optionalTestTargetSecret(name, { [env]: value }),
        (error: unknown) => {
          assert.match(String(error), new RegExp(`${name}.*registered environment source ${env}`));
          assert.equal(String(error).includes(value), false);
          return true;
        },
        value,
      );
    }
  });

  it("rejects arbitrary and mismatched test-target environment references", () => {
    assert.equal(TestTargetSecretReferenceSchema.safeParse({
      name: "separationsKualiFinalizationCanaryDocumentNumber",
      env: "HRAUTO_ARBITRARY_DOCUMENT_NUMBER",
    }).success, false);
    // The three retired person names are not merely unregistered specs: the
    // closed name schema no longer admits them at all (D300).
    for (const retired of [
      "separationsKualiFinalizationCanaryEid",
      "separationsKualiFinalizationCanaryEmployeeName",
      "separationsKualiFinalizationCanaryTimekeeperName",
    ]) {
      assert.equal(TestTargetSecretReferenceSchema.safeParse({
        name: retired,
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER",
      }).success, false, retired);
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
