import { createDryRunCompositionTestWorld } from "../../../support/helpers/backend/dry-run-composition-world.js";
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { composeDryRunScenarioCommand, resolveDryRunScenarioTarget } from "../../../../src/backend/app/dry-run/compose.js";
import { TEST_TARGET_REGISTRY } from "../../../../src/backend/app/registries/test-target-registry.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";

const {roots, TEST_MANIFEST, CHAIN_READY_MANIFEST, cleanup } = createDryRunCompositionTestWorld();


afterEach(cleanup);

describe("dry-run scenario production composition boundary", () => {
  it("persists a blocked result without constructing browser/runtime services", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-cli-"));
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      join(root, "config", "test-data.json"),
      readFileSync(join(process.cwd(), "config", "test-data.json"), "utf8"),
    );
    let runtimeFactories = 0;

    const outcome = await composeDryRunScenarioCommand({
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      isolation: rebuildRuntimeIsolation,
      args: [
        "separations-kuali-finalization",
        "--subject",
        "finalization-canary",
      ],
      repoRoot: root,
      env: {},
      clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
      loadManifest: () => Promise.resolve(TEST_MANIFEST),
      createRuntime: () => {
        runtimeFactories += 1;
        throw new Error("blocked resolution must precede runtime composition");
      },
    });

    assert.equal(runtimeFactories, 0);
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.output, /blocked: needs finalization-canary/);

    const database = AuthorityDatabase.open(
      {
        path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"),
        busyTimeoutMs: 250,
        migrationOwner: "dry-run-cli-query-test",
      },
      manualClock(new Date("2026-08-25T18:00:00.000Z")),
    );
    try {
      assert.deepEqual(
        database.authority.dryRunScenarioResults.list().map((row) => ({
          resultId: row.resultId,
          subjectLabel: row.subjectLabel,
          verdict: row.verdict,
          execution: row.execution,
        })),
        [
          {
            resultId: "11111111-1111-4111-8111-111111111111",
            subjectLabel: "finalization-canary",
            verdict: "blocked",
            execution: { state: "not-started", reason: "subject-unavailable" },
          },
        ],
      );
    } finally {
      database.close();
    }
  });
});

describe("dry-run scenario target dispatch", () => {
  it("refuses a workflow no resolver claims by naming the workflow", () => {
    assert.throws(
      () =>
        resolveDryRunScenarioTarget(
          TEST_TARGET_REGISTRY,
          { ...TEST_MANIFEST, workflow: WorkflowIdSchema.parse("i9-lookup") },
          "finalization-canary",
          testDataInputSource(),
        ),
      /dry-run target resolution does not support workflow i9-lookup/,
    );
  });

  it("blocks the available committed chain subject when its private document number is unset", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "hrauto-dry-run-chain-unconfigured-"),
    );
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      join(root, "config", "test-data.json"),
      readFileSync(join(process.cwd(), "config", "test-data.json"), "utf8"),
    );
    let runtimeFactories = 0;
    const outcome = await composeDryRunScenarioCommand({
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      isolation: rebuildRuntimeIsolation,
      args: ["separations", "--subject", "finalization-canary"],
      repoRoot: root,
      env: {},
      clock: manualClock(new Date("2026-09-03T18:00:00.000Z")),
      ids: { uuid: () => "33333333-3333-4333-8333-333333333333" },
      loadManifest: () => Promise.resolve(CHAIN_READY_MANIFEST),
      createRuntime: () => {
        runtimeFactories += 1;
        throw new Error(
          "an unconfigured subject must block before runtime composition",
        );
      },
    });

    assert.equal(runtimeFactories, 0);
    assert.equal(outcome.exitCode, 2);
    assert.match(
      outcome.output,
      /^blocked: needs finalization-canary; its Kuali document number is not configured/u,
    );
  });

  it("dispatches the available committed chain registry through createRuntime with its typed document number", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-chain-ready-"));
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      join(root, "config", "test-data.json"),
      readFileSync(join(process.cwd(), "config", "test-data.json"), "utf8"),
    );
    let capturedCanonicalInput: unknown;
    let capturedBindings: unknown;
    const testInputs = testDataInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: "4999",
    });

    await assert.rejects(
      composeDryRunScenarioCommand({
        admission: RuntimeAdmission.syntheticRoots(
          join(root, rebuildRuntimeIsolation.stateRoot),
          join(root, rebuildRuntimeIsolation.artifactRoot),
        ),
        isolation: rebuildRuntimeIsolation,
        args: ["separations", "--subject", "finalization-canary"],
        repoRoot: root,
        env: {},
        testInputs,
        clock: manualClock(new Date("2026-09-03T18:00:00.000Z")),
        ids: { uuid: () => "33333333-3333-4333-8333-333333333333" },
        loadManifest: () => Promise.resolve(CHAIN_READY_MANIFEST),
        createRuntime: () => ({
          start: (startInput) => {
            capturedCanonicalInput = startInput.canonicalInput;
            capturedBindings = startInput.protectedBindings;
            return Promise.reject(
              new Error(
                "stop the fixture runtime after capturing the ready dispatch",
              ),
            );
          },
          drain: () => Promise.reject(new Error("not reached")),
          resolveGate: () => Promise.resolve(),
          collectEvidence: () => Promise.reject(new Error("not reached")),
        }),
      }),
      /dry-run scenario failed before run identity was known/,
    );

    assert.deepEqual(capturedCanonicalInput, {
      documentNumber: "4999",
      reRead: {
        ordinal: 2,
        reason:
          "Operator-requested second read-only rehearsal with repaired pending-set observation.",
      },
    });

    assert.deepEqual(capturedBindings, [
      {
        kind: "test-data-local",
        inputPath: "documentNumber",
        name: "separationsKualiFinalizationCanaryDocumentNumber",
        sourceId: testInputs.read(
          "separationsKualiFinalizationCanaryDocumentNumber",
        )?.valueId,
      },
    ]);
    assert.equal(JSON.stringify(capturedBindings).includes("4999"), false);
  });
});
