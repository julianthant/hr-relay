import { hostConfigFacts } from "../../src/domain/config/host-display.js";
import assert from "node:assert/strict";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  admitLocalEnvironmentFile,
  assertNoMigratedEnvironmentKeys,
  inspectSecret,
  optionalSecret,
  optionalSecretFamily,
  providerModelChain,
  requireSecret,
  requireSecretFamily,
  requireSecretFile,
  SECRET_FAMILY_SPECS,
  SECRET_SPECS,
  retiredTestTargetEnvironmentRefusal,
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
import { sha256Hex } from "../../src/domain/sha256.js";
import { runTestTargetDocumentNumberSmoke } from "../../scripts/smoke-test-target-document-number.js";
import { protectedSecretSource } from "../helpers/protected-secret-source.js";
import { testDataInputSource } from "./helpers/test-data-source.js";
import { RETIRED_TEST_TARGET_ENVIRONMENT_KEYS } from "../../src/domain/config/catalog.js";
import { TestDataLocalConfigError } from "../../src/domain/test-data.js";

describe("closed secret access", () => {
  it("records boot slot provenance from the exact admitted descriptor", () => {
    const root = mkdtempSync(join(tmpdir(), "provider-boot-proof-"));
    const path = join(root, ".env.providers");
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: "synthetic-parent" };
    try {
      const receipt = { revision: 3, receiptId: "00000000-0000-4000-8000-000000000931",
        commandId: "00000000-0000-4000-8000-000000000932", writeId: "00000000-0000-4000-8000-000000000933",
        expectedRevision: 2, schemaHash: "a".repeat(64), markedFingerprint: "b".repeat(64) };
      const header = Buffer.from(canonicalJsonStringify(receipt)).toString("base64url");
      writeFileSync(path, `# hrauto-provider-keys-v1 ${header}\nGEMINI_API_KEY='synthetic-file'\nGROQ_API_KEY3='synthetic-file-three'\n`, { mode: 0o600 });
      const provenance = admitLocalEnvironmentFile(path, env);
      assert.ok(provenance);
      assert.deepEqual(provenance.parentSlotNames, ["GEMINI_API_KEY"]);
      assert.deepEqual(provenance.fileSlotNames, ["GEMINI_API_KEY", "GROQ_API_KEY3"]);
      assert.equal(provenance.fileRevision, 3);
      assert.equal(Object.isFrozen(provenance.parentSlotNames), true);
      assert.equal(Object.isFrozen(provenance.fileSlotNames), true);
      assert.equal(env.GEMINI_API_KEY, "synthetic-parent");
      assert.equal(env.GROQ_API_KEY3, "synthetic-file-three");
      const stat = statSync(path, { bigint: true });
      assert.equal(provenance.fileSourceVersionToken, sha256Hex(
        [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].map(String).join(":")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses a provider descriptor changed after its admitted bytes are read", () => {
    const root = mkdtempSync(join(tmpdir(), "provider-boot-race-"));
    const path = join(root, ".env.providers");
    const env: NodeJS.ProcessEnv = {};
    try {
      writeFileSync(path, "GROQ_API_KEY='one'\n", { mode: 0o600 });
      assert.throws(() => admitLocalEnvironmentFile(path, env, {
        open: (name, flags) => openSync(name, flags),
        inspectDescriptor: fstatSync,
        inspectIdentity: descriptor => fstatSync(descriptor, { bigint: true }),
        inspectPathIdentity: name => lstatSync(name, { bigint: true }),
        readBytes: descriptor => {
          const bytes = readFileSync(descriptor);
          writeFileSync(path, "GROQ_API_KEY='two'\n", { mode: 0o600 });
          return bytes;
        },
        close: closeSync,
      }), /changed during admission/u);
      assert.deepEqual(env, {});
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("admits parsed local environment bytes without overriding an explicit parent value", () => {
    const env: NodeJS.ProcessEnv = { GEMINI_API_KEY: "parent" };
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
          "GROQ_API_KEY=from-file",
          "GEMINI_API_KEY=from-file",
          "",
        ].join("\n"));
      },
      close: (candidate) => assert.equal(candidate, descriptor),
    });

    assert.equal(env.GROQ_API_KEY, "from-file");
    assert.equal(env.GEMINI_API_KEY, "parent");
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
          assert.match(String(error), /local environment file has invalid syntax at line \d+/u, label);
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
      "GEMINI_API_KEY=plain value\r",
      "GROQ_API_KEY='single # value = retained'\r",
      "MISTRAL_API_KEY=\"double # value = retained\" # trailing comment\r",
      "OPEN_ROUTER_API_KEY=`backtick # value = retained`\r",
      "SAMBANOVA_API_KEY=\"first line\r",
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
      GEMINI_API_KEY: "plain value",
      GROQ_API_KEY: "single # value = retained",
      MISTRAL_API_KEY: "double # value = retained",
      OPEN_ROUTER_API_KEY: "backtick # value = retained",
      SAMBANOVA_API_KEY: "first line\nsecond # line = retained",
    });
  });

  it("admits only complete provider pool families and refuses migrated names without reading parent values", () => {
    const familyCells = SECRET_FAMILY_SPECS.flatMap(({ envPrefix, maximum }) =>
      Array.from({ length: maximum }, (_, offset) =>
        offset === 0 ? envPrefix : `${envPrefix}${String(offset + 1)}`));
    const env: NodeJS.ProcessEnv = {};
    const content = `${familyCells.map((key) => `${key}=fixture`).join("\n")}\n`;
    admitLocalEnvironmentFile("/repo/.env", env, {
      open: () => 22,
      inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: content.length }),
      readBytes: () => Buffer.from(content),
      close: () => undefined,
    });
    assert.deepEqual(Object.keys(env), familyCells);

    for (const key of ["GEMINI_API_KEY1", "GEMINI_API_KEY9", "UNREGISTERED_API_KEY"]) {
      assert.throws(
        () => admitLocalEnvironmentFile("/repo/.env", {}, {
          open: () => 23,
          inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: key.length + 9 }),
          readBytes: () => Buffer.from(`${key}=fixture\n`),
          close: () => undefined,
        }),
        new RegExp(`unsupported key ${key}`),
      );
    }

    let parentValueRead = false;
    const migrated = {} as NodeJS.ProcessEnv;
    Object.defineProperty(migrated, "UCPATH_PASSWORD", {
      enumerable: true,
      get: () => {
        parentValueRead = true;
        return "CANARY_MUST_NOT_BE_READ";
      },
    });
    assert.throws(
      () => assertNoMigratedEnvironmentKeys(migrated),
      /migrated environment key UCPATH_PASSWORD is refused; set it in Settings, then remove it/u,
    );
    assert.equal(parentValueRead, false);

    const privateValue = "CANARY_MIGRATED_VALUE_MUST_NOT_ESCAPE";
    assert.throws(
      () => admitLocalEnvironmentFile("/repo/.env", {}, {
        open: () => 24,
        inspectDescriptor: () => ({ isFile: () => true, mode: 0o600, size: privateValue.length + 20 }),
        readBytes: () => Buffer.from(`TIMEKEEPER_NAME=${privateValue}\n`),
        close: () => undefined,
      }),
      (error: unknown) => String(error).includes("TIMEKEEPER_NAME")
        && !String(error).includes(privateValue),
    );
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
      /local environment file \.env\.providers permissions must be 0600 or stricter/,
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
        /local environment file \.env\.providers is unavailable/,
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
        assert.match(String(error), /local environment file \.env\.providers permissions must be 0600 or stricter/);
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
      /local environment file \.env\.providers is not a regular file/,
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
      /local environment file \.env\.providers exceeds its registered size limit/,
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
        assert.match(String(error), /local environment file \.env\.providers is unavailable/);
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
            "SecretSourceError: local environment file .env.providers could not be read and parsed",
            "SecretSourceError: local environment file .env.providers descriptor could not be closed",
          ],
        );
        return true;
      },
    );
  });

  it("resolves only registered names and fails loud at the requested scope", () => {
    const source = protectedSecretSource({ ucpathUserId: "operator" });
    const env = { GEMINI_API_KEY: "key-one", GEMINI_API_KEY2: "key-two" };
    assert.equal(optionalSecret("ucpathUserId", source), "operator");
    assert.equal(requireSecret("ucpathUserId", source), "operator");
    assert.deepEqual(optionalSecretFamily("geminiApiKeys", env), ["key-one", "key-two"]);
    assert.deepEqual(requireSecretFamily("geminiApiKeys", env), ["key-one", "key-two"]);
    assert.throws(() => requireSecret("ucpathPassword", source), /ucpathPassword/);
    assert.throws(() => validateDescriptorSecrets(["ucpathUserId", "ucpathPassword"], [], source, env), /ucpathPassword/);
    assert.throws(() => requireSecretFamily("groqApiKeys", env), /GROQ_API_KEY/);
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

  it("keeps protected registry names and provider environment families one-to-one", () => {
    assert.equal(new Set(SECRET_SPECS.map(({ name }) => name)).size, SECRET_SPECS.length);
    assert.equal(SECRET_SPECS.every(({ source }) => source === "protected-store"), true);
    assert.equal(new Set(SECRET_FAMILY_SPECS.map(({ name }) => name)).size, SECRET_FAMILY_SPECS.length);
    assert.equal(new Set(SECRET_FAMILY_SPECS.map(({ envPrefix }) => envPrefix)).size, SECRET_FAMILY_SPECS.length);
    // D341: the two test-target canaries are no longer secrets at all; the
    // protected registry carries only credentials and the timekeeper name.
    for (const retired of ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) {
      assert.equal(SECRET_SPECS.some(({ name }) => (name as string) === retired), false, retired);
    }
  });

  it("reads provider model chains only from ordinary Config", () => {
    const config = resolveConfigWithProvenance({
      providers: { gemini: { models: ["model-a", "model-b"] } },
    }, hostConfigFacts({}), manualClock(new Date("2026-09-04T12:00:00-07:00"))).config;
    assert.deepEqual(providerModelChain("geminiApiKeys", config), ["model-a", "model-b"]);
    assert.deepEqual(providerModelChain("groqApiKeys", config), []);
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
