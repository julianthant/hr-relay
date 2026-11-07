import { recordingInputSource } from "../../../support/helpers/test-target-registry-fixtures.js";
import { createTestTargetRegistryFixtures } from "../../../support/helpers/test-target-registry-fixtures.js";
import assert from "node:assert/strict";
import { chmodSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createTestDataInputSource,testDataLocalPath } from "../../../../src/backend/app/registries/test-data.js";
import {
parseTestTargetRegistry,
resolveSeparationsTestTarget,
} from "../../../../src/backend/app/registries/test-target-registry.js";
import type { TestDataInputSource } from "../../../../src/models/config/test-data.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";






const DOCUMENT_NUMBER_SECRET = {
  name: "separationsKualiFinalizationCanaryDocumentNumber",
} as const;

const FIXTURE_DOCUMENT_NUMBER = "4502";
const FIXTURE_CONFIGURED_SOURCE = testDataInputSource({
  separationsKualiFinalizationCanaryDocumentNumber: FIXTURE_DOCUMENT_NUMBER,
});


const { CHAIN_ARM, registry, rawRegistry, finalizationSubject, chainSubject } = createTestTargetRegistryFixtures(DOCUMENT_NUMBER_SECRET);

/** Every finalization canonical leaf a live read can observe, minus the four person values. */


/** The same leaves plus the two a run only has once ② has filed and ③ composed. */







const AVAILABLE = {
  state: "available",
  lastObserved: "2026-08-25",
  reason: "Synthetic complete fixture.",
} as const;










/** A test-data input source whose every read is recorded by input name. */


/** A source whose private file is invalid: the loader already refused it by key, never by value. */
const privateRoots: string[] = [];
afterEach(() => { for (const root of privateRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A REAL private file (0600) carrying one configured value, read through the production loader. */
function privateFileSource(name: string, value: string): TestDataInputSource {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-test-target-private-"));
  privateRoots.push(root);
  mkdirSync(join(root, "config"));
  const path = testDataLocalPath(root);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, inputs: {
    [name]: { valueId: "10000000-0000-4000-8000-00000000000a", value, updatedAt: "2026-09-07T00:00:00.000Z" },
  }, files: {} })}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return createTestDataInputSource(path);
}

describe("separations chain test target resolution", () => {
  it("preserves only an explicitly declared reread decision and never advances it during resolution", () => {
    const reRead = { ordinal: 1, reason: "Synthetic fresh rehearsal after a repaired read" };
    const parsed = parseTestTargetRegistry(rawRegistry([{
      ...chainSubject({ availability: AVAILABLE }),
      workflows: { separations: { ...CHAIN_ARM, publicInput: { ...CHAIN_ARM.publicInput, reRead } } },
    }]));
    const first = resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE);
    const second = resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE);
    assert.equal(first.state, "ready");
    assert.deepEqual(second, first);
    if (first.state !== "ready") throw new Error("synthetic ready resolution missing");
    assert.deepEqual(first.canonicalInput, { documentNumber: FIXTURE_DOCUMENT_NUMBER, reRead });
    const ordinary = resolveSeparationsTestTarget(
      parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })])),
      "fixture-target", FIXTURE_CONFIGURED_SOURCE,
    );
    assert.equal(ordinary.state, "ready");
    if (ordinary.state !== "ready") throw new Error("synthetic ordinary resolution missing");
    assert.equal(Object.hasOwn(ordinary.canonicalInput, "reRead"), false);
    assert.deepEqual(first.protectedBindings, ordinary.protectedBindings);
  });

  it("refuses malformed reread metadata before a private source can be accessed", () => {
    for (const reRead of [
      { ordinal: 0, reason: "Synthetic reason" }, { ordinal: 100, reason: "Synthetic reason" },
      { ordinal: 1.5, reason: "Synthetic reason" }, { ordinal: 1 }, { reason: "Synthetic reason" },
      { ordinal: 1, reason: "" }, { ordinal: 1, reason: "x".repeat(201) },
      { ordinal: 1, reason: "Synthetic reason", retry: true },
    ]) {
      assert.throws(() => parseTestTargetRegistry(rawRegistry([{
        ...chainSubject({ availability: AVAILABLE }),
        workflows: { separations: { ...CHAIN_ARM, publicInput: { ...CHAIN_ARM.publicInput, reRead } } },
      }])));
    }
  });

  it("resolves an available chain subject through the descriptor's own start box", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));

    assert.deepEqual(resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE), {
      state: "ready",
      label: "fixture-target",

      protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber",
        name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: "00000000-0000-4000-8000-000000000010" }],
      canonicalInput: {
        documentNumber: FIXTURE_DOCUMENT_NUMBER,
      },
    });
  });

  it("reads the number once through the test-data-local source", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));
    const { source, read } = recordingInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: FIXTURE_DOCUMENT_NUMBER,
    });
    const result = resolveSeparationsTestTarget(parsed, "fixture-target", source);
    assert.equal(result.state, "ready");
    assert.deepEqual(read, ["separationsKualiFinalizationCanaryDocumentNumber"]);
  });

  it("blocks BY NAME when the operator has configured no number", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));
    assert.deepEqual(resolveSeparationsTestTarget(parsed, "fixture-target", testDataInputSource()), {
      state: "blocked",
      label: "fixture-target",
      reason: "blocked: needs fixture-target; its Kuali document number is not configured — "
        + `set ${DOCUMENT_NUMBER_SECRET.name} in config/test-data.local.json`,
    });
  });

  it("defects by reference and key — never by value — on a malformed configured number", () => {

    const parsed = parseTestTargetRegistry(registry([chainSubject({ availability: AVAILABLE })]));
    assert.throws(
      () => resolveSeparationsTestTarget(parsed, "fixture-target", { read: () => { throw new TypeError("unexpected source failure"); } }),
      (error: unknown) => error instanceof TypeError && (error).name !== "TestTargetRegistryDefectError",
    );
    for (const malformed of ["abc", "1", "123456789", "CANARY_PRIVATE_DOCUMENT_NUMBER"]) {
      assert.throws(
        () => resolveSeparationsTestTarget(parsed, "fixture-target", privateFileSource(DOCUMENT_NUMBER_SECRET.name, malformed)),
        (error: unknown) => {
          assert.equal((error as Error).name, "TestTargetRegistryDefectError");
          const diagnostic = String(error);
          assert.match(diagnostic, /fixture-target marked available, last observed 2026-08-25/);
          assert.match(diagnostic, new RegExp(`document-number reference ${DOCUMENT_NUMBER_SECRET.name}`));
          assert.match(diagnostic, /config\/test-data\.local\.json/u);
          assert.match(diagnostic, /TestDataLocalConfigError/u);
          assert.equal(diagnostic.includes(malformed), false, `defect retained ${malformed}`);
          return true;
        },
        malformed,
      );
    }
  });

  it("blocks a chain label the registry does not carry", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject()]));
    assert.deepEqual(resolveSeparationsTestTarget(parsed, "unmapped-chain-target", FIXTURE_CONFIGURED_SOURCE), {
      state: "blocked",
      label: "unmapped-chain-target",
      reason: "blocked: needs unmapped-chain-target",
    });
  });

  it("blocks gone and unknown chain subjects with the registry's own dated claim", () => {
    const states = ["gone", "unknown"] as const;
    const results = states.map((state) => {
      const parsed = parseTestTargetRegistry(registry([chainSubject({
        availability: { state, lastObserved: "2026-08-19", reason: `${state} fixture` },
      })]));
      // A perfectly valid number is configured: the dated availability claim
      // must still win, so a decayed subject never reads the private file.
      return resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE);
    });
    assert.deepEqual(results, [
      {
        state: "blocked",
        label: "fixture-target",
        reason: "blocked: needs fixture-target; registry says gone, last observed 2026-08-19",
      },
      {
        state: "blocked",
        label: "fixture-target",
        reason: "blocked: needs fixture-target; registry says unknown, last observed 2026-08-19",
      },
    ]);
  });

  it("refuses by name a label whose subject declares no chain arm", () => {
    const parsed = parseTestTargetRegistry(registry([finalizationSubject()]));
    assert.throws(
      () => resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE),
      (error: unknown) => {
        // The registry defect name distinguishes bad requests from invalid registry state.
        assert.equal((error as Error).name, "TestTargetRegistryDefectError");
        assert.match(
          String(error),
          /fixture-target declares no separations arm; it declares separations-kuali-finalization/,
        );
        return true;
      },
    );
  });

  it("fails a falsely available chain subject that records no document", () => {
    const parsed = parseTestTargetRegistry(registry([chainSubject({
      availability: AVAILABLE,
      workflows: {
        separations: {
          kind: "controlled-commit-candidate",
          publicInput: { document: { state: "absent", reason: "The only mapped subject lost its row." } },
        },
      },
    })]));
    assert.throws(
      () => resolveSeparationsTestTarget(parsed, "fixture-target", FIXTURE_CONFIGURED_SOURCE),
      /fixture-target marked available, last observed 2026-08-25: no Kuali document exists to run: The only mapped subject lost its row\./,
    );
  });
});
