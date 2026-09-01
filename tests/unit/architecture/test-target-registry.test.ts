import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, it } from "vitest";
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { GENERATED_BUILD_MANIFEST } from "../../../src/domain/workflow/generated-build-manifest.js";
import { TEST_TARGET_SECRET_SPECS } from "../../../src/domain/secrets.js";
import {
  parseDryRunScenarioManifest,
  type DryRunScenarioManifest,
} from "../../../src/domain/trust/dry-run-scenario.js";
import {
  FINALIZATION_WORKFLOW,
  readTestTargetRegistry,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  SEPARATIONS_WORKFLOW,
  TEST_TARGET_REGISTRY,
  TestTargetWorkflowArmsSchema,
  type TestTargetManifestView,
  type TestTargetRegistryEntry,
} from "../../../src/control/test-target-registry.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

const WORKFLOW_SCENARIO_ROOT = "tests/scenario/workflows";
const MANIFEST_FILE = "dry-run.scenario.ts";
const MANIFEST_REGISTRY_PATH = "src/server/dry-run-scenario/manifests.ts";
const MANIFEST_MODULE = "domain/trust/dry-run-scenario.js";
const PHASE_DOC_PATH = "docs/rebuild/03b-finish-separations.md";
/** The one order-8 status line that names the mapped inventory in prose. */
const INVENTORY_LINE_MARKER = "the subject/canary inventory mapped live and dated";

/**
 * Every T1b manifest in the layout (ref guards-and-tests §10.9), by workflow id
 * — the folder name IS the workflow id, which the parse arm below re-proves
 * against the declaration's own `workflow` field.
 */
function manifestPathsByWorkflow(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(join(REPO_ROOT, WORKFLOW_SCENARIO_ROOT), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `${WORKFLOW_SCENARIO_ROOT}/${entry.name}/${MANIFEST_FILE}`;
    if (existsSync(join(REPO_ROOT, path))) found.set(entry.name, path);
  }
  if (found.size === 0) {
    throw new Error(`the T1b walk found no ${MANIFEST_FILE} under ${WORKFLOW_SCENARIO_ROOT}, so it proves nothing`);
  }
  return found;
}

/**
 * Evaluate a T1b declaration WITHOUT importing it.
 *
 * A vitest-collected file may not import a manifest (the sibling
 * `structural.scenario.test.ts` proves nothing does, in both static and dynamic
 * form), so this guard transpiles the declaration and runs it in an isolated
 * `node:vm` context whose only reachable module is the real manifest parser.
 * Reading the file as text and re-deriving its object literal would re-implement
 * zod; running it is what proves the checked-in declaration parses.
 */
function evaluateManifest(path: string): DryRunScenarioManifest {
  const transpiled = ts.transpileModule(readFileSync(join(REPO_ROOT, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: (specifier: string): unknown => {
      if (!specifier.endsWith(MANIFEST_MODULE)) {
        throw new Error(`${path} may only import the manifest parser, not ${specifier}`);
      }
      return { parseDryRunScenarioManifest };
    },
  });
  vm.runInContext(transpiled, context, { filename: path });
  const exported = Object.values(moduleRecord.exports);
  const only = exported[0];
  if (exported.length !== 1 || only === undefined) {
    throw new Error(`${path} must export exactly one manifest; it exports ${String(exported.length)}`);
  }
  return parseDryRunScenarioManifest(only);
}

function manifestView(manifest: DryRunScenarioManifest): TestTargetManifestView {
  return {
    workflow: manifest.workflow,
    cases: manifest.cases.map(({ subjectLabel, subjectKind }) => ({ subjectLabel, subjectKind })),
  };
}

const RECEIPT_NODE_OBLIGATION_PREFIX = "node.";

/** Every node id a manifest case names, in one flat list. */
function nodeIdsNamedBy(manifest: DryRunScenarioManifest): readonly string[] {
  return [
    manifest.transactionNode,
    ...manifest.cases.flatMap((scenarioCase) => [
      ...scenarioCase.nodesReached,
      ...scenarioCase.nodesExcluded,
      ...scenarioCase.checkpoints.map(({ node }) => node),
      ...scenarioCase.gateResults.map(({ gate }) => gate),
      ...(scenarioCase.terminal.lifecycle === "failed"
        ? [scenarioCase.terminal.node]
        : [scenarioCase.terminal.stoppedAtNodeId]),
      // A receipt obligation `node.<id>` names the same graph node — its
      // verification is a `node-output` obligation source (ref evidence
      // obligations), not a free-text label — so it names a real node
      // exactly as much as a checkpoint or a gate result does.
      ...scenarioCase.receipt.verification
        .map(({ obligation }) => obligation)
        .filter((obligation) => obligation.startsWith(RECEIPT_NODE_OBLIGATION_PREFIX))
        .map((obligation) => obligation.slice(RECEIPT_NODE_OBLIGATION_PREFIX.length)),
    ]),
  ];
}

/**
 * The workflows the production manifest registry can actually load, read off
 * its own source. `src/server/dry-run-scenario/manifests.ts` is the ONE place
 * a workflow id is paired with its T1b loader — `src/cli.ts` only calls
 * `loadDryRunScenarioManifest`, so this is the composition root's real
 * registration surface. It is inspected as data rather than imported: the
 * loaders it holds are live `import()` calls this guard must not trigger.
 */
function workflowsRegisteredByManifestRegistry(): ReadonlyMap<string, string> {
  const source = readFileSync(join(REPO_ROOT, MANIFEST_REGISTRY_PATH), "utf8");
  const registered = new Map<string, string>();
  const entry = /\[\s*"(?<workflow>[a-z0-9-]+)",[\s\S]{0,400}?import\(\s*\n?\s*"(?<path>[^"]*dry-run\.scenario\.js)"/gu;
  for (const match of source.matchAll(entry)) {
    const { workflow, path } = match.groups ?? {};
    if (workflow === undefined || path === undefined) continue;
    registered.set(workflow, path);
  }
  if (registered.size === 0) {
    throw new Error(`${MANIFEST_REGISTRY_PATH} registers no dry-run scenario manifest, so this guard proves nothing`);
  }
  return registered;
}

/**
 * The one subject D284 left, and the document both of its arms address. The
 * literals are the guard's own — transcribed from doc 03b §The canary registry
 * and `docs/migrations/separations.md` §9.19/§9.31 — so config cannot drift
 * from the doc it claims to be the as-built of without this file going red.
 */
const SOLE_SUBJECT_LABEL = "finalization-canary";
const SOLE_SUBJECT_DOCUMENT = "4537";
const SOLE_SUBJECT_LAST_OBSERVED = "2026-08-28";

/**
 * Every arm key `TestTargetWorkflowArmsSchema` declares, derived from the
 * schema itself rather than hardcoded, so a third arm added to the schema
 * cannot go silently uncased by this file. The sanity assertion right below
 * pins today's known set — if the schema ever grows a third key, that
 * assertion goes red and the growth becomes a visible, deliberate change here.
 */
const ARM_WORKFLOW_KEYS = Object.keys(TestTargetWorkflowArmsSchema.shape) as readonly (keyof typeof TestTargetWorkflowArmsSchema.shape)[];
assert.deepEqual([...ARM_WORKFLOW_KEYS].sort(), [FINALIZATION_WORKFLOW, SEPARATIONS_WORKFLOW].sort());

/**
 * Every `(workflow, kind)` arm a registry entry declares, in the schema's own
 * key order. The registry judges a manifest case against an ARM, not an entry
 * (D284), so the reverse direction — every arm has a case — walks the same
 * shape rather than a label list.
 */
function armsDeclaredBy(target: TestTargetRegistryEntry): readonly Readonly<{ workflow: string; kind: string }>[] {
  return ARM_WORKFLOW_KEYS.flatMap((workflow) => {
    const arm = target.workflows[workflow];
    return arm === undefined ? [] : [{ workflow, kind: arm.kind }];
  });
}

/**
 * The doc side of the registry pin. Doc 03b no longer carries the table — it
 * carries ONE status line naming every Kuali document the registry holds as an
 * active identity, and `config/test-subjects.json` must hold exactly that set,
 * in both directions. A document that quietly leaves either side is the drift
 * the registry exists to prevent (§9.16 recorded two canaries evaporating; D284
 * retired every document but one, and the line may name no other).
 */
function documentNumbersNamedByPhaseDoc(): readonly string[] {
  const lines = readFileSync(join(REPO_ROOT, PHASE_DOC_PATH), "utf8").split("\n");
  const matches = lines.filter((line) => line.includes(INVENTORY_LINE_MARKER));
  const only = matches[0];
  if (matches.length !== 1 || only === undefined) {
    throw new Error(`${PHASE_DOC_PATH} must name the mapped canary inventory on exactly one line`);
  }
  const numbers = only.match(/\b4\d{3}\b/g);
  if (numbers === null) {
    throw new Error(`${PHASE_DOC_PATH} inventory line names no Kuali document number`);
  }
  return [...new Set(numbers)].sort();
}

function documentNumbersRegisteredInConfig(): readonly string[] {
  const numbers = TEST_TARGET_REGISTRY.targets.flatMap((target) => {
    const chain = target.workflows.separations;
    const finalization = target.workflows["separations-kuali-finalization"];
    const fromChain = chain !== undefined && chain.publicInput.document.state === "present"
      ? [chain.publicInput.document.documentNumber]
      : [];
    const declared = finalization?.publicInput.documentNumber;
    return declared === undefined ? fromChain : [...fromChain, declared];
  });
  return [...new Set(numbers)].sort();
}

describe("test target registry architecture", () => {
  it("parses every T1b manifest in the layout and names only nodes its descriptor declares", () => {
    for (const [workflow, path] of manifestPathsByWorkflow()) {
      const manifest = evaluateManifest(path);
      assert.equal(manifest.workflow, workflow, `${path} declares workflow ${manifest.workflow} under folder ${workflow}`);
      const descriptor = DESCRIPTORS.find(({ id }) => id === workflow);
      if (descriptor === undefined) throw new Error(`${path} names workflow ${workflow}, which no descriptor builds`);
      const declared = new Set<string>(descriptorRuntimeNodes(descriptor).map(({ id }) => id));
      for (const node of nodeIdsNamedBy(manifest)) {
        assert.equal(declared.has(node), true, `${path} names node ${node}, which ${workflow} does not declare`);
      }
    }
  });

  it("registers every T1b manifest label in config with the same workflow and kind", () => {
    const views = [...manifestPathsByWorkflow().values()].map((path) => manifestView(evaluateManifest(path)));
    // `readTestTargetRegistry` refuses an unregistered label, a workflow
    // mismatch and a kind mismatch; asserting it does not throw IS the pin.
    const registry = readTestTargetRegistry(REPO_ROOT, views);
    const registered = new Set(registry.targets.map(({ label }) => label));
    for (const view of views) {
      assert.equal(view.cases.length > 0, true, `manifest ${view.workflow} declares no case`);
      for (const { subjectLabel } of view.cases) {
        assert.equal(registered.has(subjectLabel), true, `manifest label ${subjectLabel} is unregistered`);
      }
    }
  });

  it("gives every registry arm a manifest case in that workflow's own manifest", () => {
    const views = new Map([...manifestPathsByWorkflow().values()]
      .map((path) => manifestView(evaluateManifest(path)))
      .map((view) => [view.workflow, view]));
    // The reverse direction of the parse arm above: an arm is a claim that a
    // workflow can address this subject, and a claim no manifest rehearses is
    // an entry nobody runs. D284 retired the "rehearsable roles" filter with
    // the roles — every arm the registry still declares must be cased.
    for (const target of TEST_TARGET_REGISTRY.targets) {
      for (const { workflow, kind } of armsDeclaredBy(target)) {
        const manifest = views.get(workflow);
        if (manifest === undefined) throw new Error(`registry arm ${target.label}/${workflow} has no T1b manifest to be cased in`);
        const cased = manifest.cases.some(({ subjectLabel, subjectKind }) =>
          subjectLabel === target.label && subjectKind === kind);
        assert.equal(cased, true, `registry arm ${target.label}/${workflow} (${kind}) has no manifest case`);
      }
    }
  });

  it("commits exactly one subject, addressable by both workflows on the same Kuali document", () => {
    // D284: one label, one availability, one document — an arm per workflow,
    // never a second entry and never an alias.
    assert.deepEqual(TEST_TARGET_REGISTRY.targets.map(({ label }) => label), [SOLE_SUBJECT_LABEL]);
    const [subject] = TEST_TARGET_REGISTRY.targets;
    if (subject === undefined) throw new Error("the committed registry holds no subject");
    assert.deepEqual(armsDeclaredBy(subject), [
      { workflow: SEPARATIONS_WORKFLOW, kind: "full-chain-dry-run" },
      { workflow: FINALIZATION_WORKFLOW, kind: "ordinary" },
    ]);
    assert.deepEqual(subject.workflows[SEPARATIONS_WORKFLOW]?.publicInput.document, {
      state: "present",
      documentNumber: SOLE_SUBJECT_DOCUMENT,
    });
    assert.equal(subject.workflows[FINALIZATION_WORKFLOW]?.publicInput.documentNumber, SOLE_SUBJECT_DOCUMENT);
  });

  it("registers exactly the layout's T1b manifests in the manifest registry, each at its own path", () => {
    const layout = manifestPathsByWorkflow();
    const registered = workflowsRegisteredByManifestRegistry();
    assert.deepEqual([...registered.keys()].sort(), [...layout.keys()].sort());
    for (const [workflow, path] of registered) {
      assert.equal(
        path.endsWith(`${WORKFLOW_SCENARIO_ROOT}/${workflow}/dry-run.scenario.js`),
        true,
        `${MANIFEST_REGISTRY_PATH} loads ${workflow} from ${path}, which is not that workflow's T1b manifest`,
      );
    }
  });

  it("pins the sole subject to its 2026-08-28 read-only re-verification and its declared-pending leaves", () => {
    const canary = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === SOLE_SUBJECT_LABEL);
    assert.equal(canary?.availability.state, "available");
    assert.equal(canary?.availability.lastObserved, SOLE_SUBJECT_LAST_OBSERVED);
    // D284: 4537 is available as a DOCUMENT; what is still missing is the
    // transaction number ② has not filed, and the entry says so in words —
    // and declares it, so the finalization resolver blocks BY NAME instead of
    // reporting a registry defect (§10.5). `terminationEffectiveDate` joins
    // them: the live form's field is EMPTY, so the value the finalization
    // stages (separation date + 1) is composed by the chain's dates node, not
    // observed. Exactly these three pending leaves, no more.
    assert.match(String(canary?.availability.reason), /[Tt]ransaction number empty/);
    const pending = canary?.workflows[FINALIZATION_WORKFLOW]?.pending ?? {};
    // The resolver judges a leaf pending by a DEFINED reason; zod keeps an
    // explicitly-`undefined` key on the parsed object, so `Object.keys` alone
    // would let an unreasoned key slip past this pin unnoticed. Filter to
    // entries whose reason is actually defined before asserting the set.
    assert.deepEqual(
      Object.entries(pending)
        .filter(([, reason]) => reason !== undefined)
        .map(([key]) => key),
      ["transactionNumber", "timekeeperComments", "terminationEffectiveDate"],
    );
  });

  it("blocks every currently declared label before consulting live person secrets", () => {
    const resolutions = TEST_TARGET_REGISTRY.targets
      .filter((target) => target.workflows["separations-kuali-finalization"] !== undefined)
      .map(({ label }) =>
        resolveSeparationsKualiFinalizationTestTarget(TEST_TARGET_REGISTRY, label, {
          HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "MUST_NOT_BE_READ",
          HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: "MUST_NOT_BE_READ",
          HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: "MUST_NOT_BE_READ",
        }));
    // `.every` on an empty array is vacuously true: assert WHICH labels the
    // filter yielded first, so a registry that stopped declaring a finalization
    // arm cannot pass this guard by resolving nothing.
    assert.deepEqual(resolutions.map(({ label }) => label), [SOLE_SUBJECT_LABEL]);
    assert.equal(resolutions.every(({ state }) => state === "blocked"), true);
  });

  it("keeps every person-valued canonical leaf out of public config", () => {
    const publicKeys = TEST_TARGET_REGISTRY.targets.flatMap(({ workflows }) => [
      ...Object.keys(workflows["separations-kuali-finalization"]?.publicInput ?? {}),
      ...Object.keys(workflows.separations?.publicInput ?? {}),
    ]);
    for (const field of ["employeeName", "emplId", "documentEid", "timekeeperName"]) {
      assert.equal(publicKeys.includes(field), false, `${field} is committed as public config`);
    }
  });

  it("binds all three canary person values to exact registered references", () => {
    const finalization = TEST_TARGET_REGISTRY.targets[0]?.workflows[FINALIZATION_WORKFLOW];
    if (finalization === undefined) throw new Error("the sole canary has no finalization arm");
    assert.deepEqual(finalization.secretInput, {
      employeeName: {
        name: "separationsKualiFinalizationCanaryEmployeeName",
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME",
      },
      emplId: {
        name: "separationsKualiFinalizationCanaryEid",
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
      },
      timekeeperName: {
        name: "separationsKualiFinalizationCanaryTimekeeperName",
        env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME",
      },
      documentEid: {
        state: "present",
        eid: {
          name: "separationsKualiFinalizationCanaryEid",
          env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
        },
      },
    });
    assert.deepEqual(
      TEST_TARGET_SECRET_SPECS.map(({ name, env, valueKind, classification }) => ({
        name,
        env,
        valueKind,
        classification,
      })),
      [
        {
          name: "separationsKualiFinalizationCanaryEid",
          env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID",
          valueKind: "eid",
          classification: "direct-identifier",
        },
        {
          name: "separationsKualiFinalizationCanaryEmployeeName",
          env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME",
          valueKind: "employee-display-name",
          classification: "direct-identifier",
        },
        {
          name: "separationsKualiFinalizationCanaryTimekeeperName",
          env: "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME",
          valueKind: "timekeeper-display-name",
          classification: "direct-identifier",
        },
      ],
    );
  });

  it("exports a recursively frozen committed registry", () => {
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY), true);
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY.targets), true);
    assert.equal(TEST_TARGET_REGISTRY.targets.every((target) =>
      Object.isFrozen(target) && Object.isFrozen(target.workflows)), true);
    const secretInput = TEST_TARGET_REGISTRY.targets[0]?.workflows[FINALIZATION_WORKFLOW]?.secretInput;
    assert.equal(Object.isFrozen(secretInput), true);
    assert.equal(Object.isFrozen(secretInput?.employeeName), true);
    assert.equal(Object.isFrozen(secretInput?.emplId), true);
    assert.equal(Object.isFrozen(secretInput?.timekeeperName), true);
    assert.equal(Object.isFrozen(secretInput?.documentEid), true);
    if (secretInput?.documentEid.state !== "present") {
      throw new Error("the committed canary does not carry a document EID reference");
    }
    assert.equal(Object.isFrozen(secretInput.documentEid.eid), true);
  });

  it("registers exactly the Kuali documents doc 03b's inventory line names", () => {
    assert.deepEqual(documentNumbersRegisteredInConfig(), documentNumbersNamedByPhaseDoc());
    // The set is pinned as a literal too, so a doc edit that adds a number to
    // config AND the line together still has to change this file on purpose.
    assert.deepEqual(documentNumbersRegisteredInConfig(), [SOLE_SUBJECT_DOCUMENT]);
  });

  it("gives every entry an owning workflow the build manifest actually built", () => {
    const built = new Set<string>(GENERATED_BUILD_MANIFEST.workflows.map(({ id }) => id));
    for (const { label, workflows } of TEST_TARGET_REGISTRY.targets) {
      for (const workflow of Object.keys(workflows)) {
        assert.equal(built.has(workflow), true, `test target ${label} names unbuilt workflow ${workflow}`);
      }
    }
  });

  it("pins every separations chain subject to doc 03b's kind and availability", () => {
    const rows = TEST_TARGET_REGISTRY.targets
      .flatMap((target) => {
        const chain = target.workflows.separations;
        return chain === undefined ? [] : [{
          label: target.label,
          kind: chain.kind,
          state: target.availability.state,
          lastObserved: target.availability.lastObserved,
          document: chain.publicInput.document.state === "present"
            ? chain.publicInput.document.documentNumber
            : "none",
        }];
      })
      .sort((left, right) => left.label.localeCompare(right.label));
    assert.deepEqual(rows, [
      {
        label: SOLE_SUBJECT_LABEL,
        kind: "full-chain-dry-run",
        state: "available",
        lastObserved: SOLE_SUBJECT_LAST_OBSERVED,
        document: SOLE_SUBJECT_DOCUMENT,
      },
    ]);
  });

  /**
   * D284 left ONE subject, declared for BOTH resolvers, so the committed
   * registry can no longer exhibit a label that belongs to the other workflow.
   * What it must still exhibit is that each resolver answers from its OWN arm
   * and never guesses across the boundary: the chain resolves the typed
   * document number, and the finalization refuses to invent the transaction
   * number ② has not filed. The refusal-BY-NAME path for a subject that lacks
   * an arm is pinned in tests/unit/test-target-registry.test.ts, which can
   * construct such a subject without committing a false one to config.
   */
  it("answers both resolvers from the one subject's own arm, without cross-workflow guessing", () => {
    const chain = resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, "finalization-canary");
    assert.deepEqual(chain, {
      state: "ready",
      label: "finalization-canary",
      canonicalInput: { documentNumber: "4537", timekeeperName: "Julian Zaw", searchTimeoutMs: 15_000 },
    });
    const finalization = resolveSeparationsKualiFinalizationTestTarget(
      TEST_TARGET_REGISTRY,
      "finalization-canary",
      {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "MUST_NOT_BE_READ",
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EMPLOYEE_NAME: "MUST_NOT_BE_READ",
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_TIMEKEEPER_NAME: "MUST_NOT_BE_READ",
      },
    );
    assert.equal(finalization.state, "blocked");
    assert.match(
      finalization.state === "blocked" ? finalization.reason : "",
      /blocked: needs finalization-canary for separations-kuali-finalization; transactionNumber /,
    );
  });

  it("gives every entry the purpose the registry exists to record", () => {
    for (const { label, purpose } of TEST_TARGET_REGISTRY.targets) {
      assert.equal(purpose.length > 0, true, `test target ${label} records no purpose`);
    }
  });
});
