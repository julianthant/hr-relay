import type { ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import { z } from "zod";
import {
  DryRunAssertionOutcomeSchema,
  DryRunSubjectLabelSchema,
} from "../../../models/trust/dry-run-scenario-result.js";
import {
  DryRunScenarioResultSchema,
  type DryRunScenarioResult,
} from "../../../models/trust/dry-run-scenario-result.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import {
  ErrorCodeSchema,
  FailureFingerprintSchema,
  NodeIdSchema,
  WorkflowIdSchema,
} from "../../../rules/identity/ids.js";
import {
  deriveDryRunScenarioManifestDigest,
  DryRunWriteSafetyCountsSchema,
  parseDryRunScenarioManifest,
  type DryRunScenarioAnyCase,
  type DryRunScenarioManifest,
  type DryRunWriteSafetyCounts,
} from "../../../models/trust/dry-run-scenario.js";

export interface DryRunScenarioArguments {
  readonly workflow: string;
  readonly subjectLabel: string;
}

export const DRY_RUN_SCENARIO_USAGE =
  "dry-run-scenario <workflow> --subject <label>";

export function parseDryRunScenarioArguments(args: readonly string[]): DryRunScenarioArguments {
  if (args.length !== 3 || args[1] !== "--subject") {
    throw new Error(`usage: ${DRY_RUN_SCENARIO_USAGE}`);
  }
  return Object.freeze({
    workflow: WorkflowIdSchema.parse(args[0]),
    subjectLabel: DryRunSubjectLabelSchema.parse(args[2]),
  });
}

export type DryRunScenarioTargetResolution =
  | Readonly<{ state: "blocked"; label: string; reason: string }>
  | Readonly<{ state: "ready"; label: string; canonicalInput: unknown; protectedBindings?: readonly ProtectedInputBinding[] }>;

const EvidenceCheckpointSchema = z.strictObject({
  node: z.string().min(1),
  attempt: z.number().int().positive(),
  keyedBy: z.array(z.enum(["workflow", "item", "node", "attempt", "claimGeneration"])).min(1),
});

const EvidenceGateResultSchema = z.strictObject({
  gate: z.string().min(1),
  decision: z.string().min(1),
  resolvedBy: z.string().min(1),
});

const EvidenceReceiptSchema = z.strictObject({
  result: z.enum(["verified-done", "done-with-warnings", "failed", "cancelled", "partial"]),
  confidence: z.enum(["verified", "partial", "unknown"]),
  verification: z.array(z.strictObject({
    obligation: z.string().min(1),
    verdict: z.enum(["verified", "present", "absent", "unknown", "ambiguous"]),
    mandatory: z.boolean(),
  })),
});

const EvidencePreviewSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("would-prepare"),
    subject: z.enum(["match", "mismatch", "unscoped", "not-observed"]),
    staged: z.boolean(),
  }),
  z.strictObject({
    outcome: z.literal("already-present"),
    proofSource: z.enum(["durable-intent", "live-probe"]),
    staged: z.literal(false),
    subject: z.literal("not-observed"),
  }),
]);

// A terminal is a preview, ordinary live-read result, or pre-start refusal.
const EvidenceTerminalSchema = z.discriminatedUnion("lifecycle", [
  z.strictObject({
    lifecycle: z.literal("done"),
    resultSchema: z.literal("RunDryRunPreviewResultSchema"),
    kind: z.literal("dry-run-preview"),
    externalCommit: z.literal("none"),
    stoppedAtNodeId: z.string().min(1),
    preview: EvidencePreviewSchema,
  }),
  z.strictObject({
    lifecycle: z.literal("done-live-read"),
    resultSchema: z.literal("workflow-result"),
    kind: z.literal("live-read"),
  }),
  z.strictObject({
    lifecycle: z.literal("failed"),
    code: ErrorCodeSchema,
    node: NodeIdSchema,
    fingerprint: FailureFingerprintSchema,
  }),
]);

export const DryRunScenarioEvidenceSchema = z.strictObject({
  reachedNodeIds: z.array(z.string().min(1)),
  checkpoints: z.array(EvidenceCheckpointSchema),
  gateResults: z.array(EvidenceGateResultSchema),
  writeSafetyAfter: DryRunWriteSafetyCountsSchema,
  screenshots: z.array(z.strictObject({
    node: NodeIdSchema,
    attempt: z.number().int().positive(),
    sessionId: z.uuid(),
    bundleId: z.uuid(),
    artifactId: z.uuid(),
  })).optional(),
  receipt: EvidenceReceiptSchema,
  terminal: EvidenceTerminalSchema,
});

const DryRunScenarioStartedSchema = z.strictObject({
  runId: z.string().uuid(),
  traceId: z.string().min(1),
  writeSafetyBefore: DryRunWriteSafetyCountsSchema,
});
export type DryRunScenarioStarted = z.infer<typeof DryRunScenarioStartedSchema>;

export interface DryRunScenarioRuntime {
  readonly start: (input: Readonly<{
    manifest: DryRunScenarioManifest;
    scenarioCase: DryRunScenarioAnyCase;
    canonicalInput: unknown;
    protectedBindings?: readonly ProtectedInputBinding[];
  }>) => Promise<DryRunScenarioStarted>;
  readonly drain: (workflow: string) => Promise<void>;
  readonly resolveGate: (input: Readonly<{
    manifest: DryRunScenarioManifest;
    scenarioCase: DryRunScenarioAnyCase;
    runId: string;
  }>) => Promise<void>;
  readonly collectEvidence: (runId: string) => Promise<unknown>;
}

export interface RunDryRunScenarioInput {
  readonly args: DryRunScenarioArguments;
  readonly loadManifest: (workflow: string) => Promise<unknown>;
  readonly resolveTarget: (
    manifest: DryRunScenarioManifest,
    subjectLabel: string,
  ) => DryRunScenarioTargetResolution;
  readonly persistResult: (result: DryRunScenarioResult) => void;
  readonly createRuntime: () => DryRunScenarioRuntime;
  readonly clock: Clock;
  readonly ids: IdFactory;
}

export interface DryRunScenarioCliOutcome {
  readonly verdict: "met" | "blocked" | "failed";
  readonly exitCode: 0 | 1 | 2;
  readonly resultId: string;
  readonly output: string;
}

function selectScenarioCase(
  manifest: DryRunScenarioManifest,
  subjectLabel: string,
): DryRunScenarioAnyCase {
  const matches: readonly DryRunScenarioAnyCase[] = manifest.cases.filter(
    (scenarioCase) => scenarioCase.subjectLabel === subjectLabel,
  );
  if (matches.length !== 1) {
    throw new Error(
      `dry-run manifest ${manifest.workflow} has ${String(matches.length)} cases for subject ${subjectLabel}; exactly one is required`,
    );
  }
  const selected = matches[0];
  if (selected === undefined) throw new Error("the selected dry-run case disappeared");
  return selected;
}

function wallTimeMs(clock: Clock, startedAt: number): number {
  return Math.max(0, Math.round(clock.monotonicMs() - startedAt));
}

type AssertionOutcome = DryRunScenarioResult["assertions"][number];

function assertion(
  assertionId: string,
  matches: boolean,
  metReason: string,
  failedReason: string,
): AssertionOutcome {
  return DryRunAssertionOutcomeSchema.parse({
    assertionId,
    verdict: matches ? "met" : "failed",
    reason: matches ? metReason : failedReason,
  });
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function evaluateDryRunScenarioEvidence(
  arm: DryRunScenarioManifest["arm"],
  scenarioCase: DryRunScenarioAnyCase,
  before: DryRunWriteSafetyCounts,
  inputEvidence: unknown,
): readonly AssertionOutcome[] {
  // The manifest's declared arm is the authority; the case shape must agree
  // with it rather than select the assertion set on its own.
  if ((arm === "live-read") === ("preview" in scenarioCase)) {
    throw new Error(`dry-run case ${scenarioCase.caseId} does not belong to the ${arm} arm`);
  }
  const evidence = DryRunScenarioEvidenceSchema.parse(inputEvidence);
  const expectedCheckpoints = scenarioCase.checkpoints.map(({ node, attempt, keyedBy }) => ({
    node,
    attempt,
    keyedBy,
  }));
  const expectedGates = scenarioCase.gateResults.map(({ gate, decision, resolvedBy }) => ({
    gate,
    decision,
    resolvedBy,
  }));
  const deltas = {
    writeIntents: evidence.writeSafetyAfter.writeIntents - before.writeIntents,
    writeAttempts: evidence.writeSafetyAfter.writeAttempts - before.writeAttempts,
    confirmedOperations: evidence.writeSafetyAfter.confirmedOperations - before.confirmedOperations,
  };
  // Released manifests declare zero outbox deltas. Schema40 retires that table;
  // their no-write obligation now checks actual durable confirmations instead.
  const expectedDeltas = {
    writeIntents: scenarioCase.durableDeltas.writeIntents,
    writeAttempts: scenarioCase.durableDeltas.writeAttempts,
    confirmedOperations: scenarioCase.durableDeltas.durableOutbox,
  };
  const failedTerminalMatches = scenarioCase.terminal.lifecycle === "failed"
    && evidence.terminal.lifecycle === "failed"
    && evidence.terminal.code === scenarioCase.terminal.code
    && evidence.terminal.node === scenarioCase.terminal.node
    && evidence.terminal.fingerprint === scenarioCase.terminal.fingerprint;

  const screenshots = scenarioCase.screenshots === undefined ? [] : [assertion("screenshot-actions",
    evidence.screenshots !== undefined
      && same(evidence.screenshots.map(row => row.node), scenarioCase.screenshots.nodes)
      && evidence.screenshots.every(row => expectedCheckpoints.some(checkpoint => checkpoint.node === row.node && checkpoint.attempt === row.attempt))
      && new Set(evidence.screenshots.map(row => `${row.bundleId}:${row.artifactId}`)).size === evidence.screenshots.length,
    "screenshot-actions-match", "screenshot-actions-mismatch")];

  if (!("preview" in scenarioCase)) {
    const terminalMatches = scenarioCase.terminal.lifecycle === "failed"
      ? failedTerminalMatches
      : evidence.terminal.lifecycle === "done-live-read"
        && evidence.terminal.resultSchema === scenarioCase.terminal.resultSchema
        && evidence.terminal.kind === scenarioCase.terminal.kind;
    return Object.freeze([
      assertion("nodes-reached", same(evidence.reachedNodeIds, scenarioCase.nodesReached),
        "nodes-reached-match", "nodes-reached-mismatch"),
      assertion("nodes-excluded", scenarioCase.nodesExcluded.every((node) => !evidence.reachedNodeIds.includes(node)),
        "nodes-excluded-match", "nodes-excluded-reached"),
      assertion("checkpoints", same(evidence.checkpoints, expectedCheckpoints),
        "checkpoints-match", "checkpoints-mismatch"),
      assertion("gate-results", same(evidence.gateResults, expectedGates),
        "gate-results-match", "gate-results-mismatch"),
      assertion("write-safety-deltas", same(deltas, expectedDeltas),
        "write-safety-deltas-zero", "write-safety-deltas-nonzero"),
      assertion("receipt", evidence.receipt.result === scenarioCase.receipt.result
        && evidence.receipt.confidence === scenarioCase.receipt.confidence
        && same(evidence.receipt.verification, scenarioCase.receipt.verification),
      "receipt-match", "receipt-mismatch"),
      assertion("terminal", terminalMatches, "terminal-match", "terminal-mismatch"),
      ...screenshots,
    ]);
  }
  const terminalMatches = scenarioCase.terminal.lifecycle === "failed"
    ? failedTerminalMatches
    : evidence.terminal.lifecycle === "done"
      && evidence.terminal.resultSchema === scenarioCase.terminal.resultSchema
      && evidence.terminal.kind === scenarioCase.terminal.kind
      && evidence.terminal.externalCommit === scenarioCase.terminal.externalCommit
      && evidence.terminal.stoppedAtNodeId === scenarioCase.terminal.stoppedAtNodeId;
  const previewMatches = scenarioCase.preview.outcome === "not-reached"
    ? evidence.terminal.lifecycle === "failed"
    : evidence.terminal.lifecycle === "done"
      && evidence.terminal.preview.outcome === scenarioCase.preview.outcome
      && (scenarioCase.preview.outcome === "would-prepare"
        ? evidence.terminal.preview.outcome === "would-prepare"
          && evidence.terminal.preview.subject === scenarioCase.preview.subject
          && evidence.terminal.preview.staged === scenarioCase.preview.staged
        : evidence.terminal.preview.outcome === "already-present"
          && evidence.terminal.preview.proofSource === scenarioCase.preview.proofSource);

  return Object.freeze([
    assertion("nodes-reached", same(evidence.reachedNodeIds, scenarioCase.nodesReached),
      "nodes-reached-match", "nodes-reached-mismatch"),
    assertion("nodes-excluded", scenarioCase.nodesExcluded.every((node) => !evidence.reachedNodeIds.includes(node)),
      "nodes-excluded-match", "nodes-excluded-reached"),
    assertion("checkpoints", same(evidence.checkpoints, expectedCheckpoints),
      "checkpoints-match", "checkpoints-mismatch"),
    assertion("gate-results", same(evidence.gateResults, expectedGates),
      "gate-results-match", "gate-results-mismatch"),
    assertion("write-safety-deltas", same(deltas, expectedDeltas),
      "write-safety-deltas-zero", "write-safety-deltas-nonzero"),
    assertion("receipt", evidence.receipt.result === scenarioCase.receipt.result
      && evidence.receipt.confidence === scenarioCase.receipt.confidence
      && same(evidence.receipt.verification, scenarioCase.receipt.verification),
    "receipt-match", "receipt-mismatch"),
    assertion("terminal", terminalMatches, "terminal-match", "terminal-mismatch"),
    assertion("preview", previewMatches, "preview-match", "preview-mismatch"),
    ...screenshots,
  ]);
}

export async function runDryRunScenario(
  input: RunDryRunScenarioInput,
): Promise<DryRunScenarioCliOutcome> {
  const startedAt = input.clock.monotonicMs();
  const manifest = parseDryRunScenarioManifest(await input.loadManifest(input.args.workflow));
  if (manifest.workflow !== input.args.workflow) {
    throw new Error(
      `dry-run manifest ${manifest.scenarioId} declares workflow ${manifest.workflow}, not requested ${input.args.workflow}`,
    );
  }
  const scenarioCase = selectScenarioCase(manifest, input.args.subjectLabel);
  const resolution = input.resolveTarget(manifest, scenarioCase.subjectLabel);
  if (resolution.label !== scenarioCase.subjectLabel) {
    throw new Error(
      `test target resolver returned label ${resolution.label} for requested ${scenarioCase.subjectLabel}`,
    );
  }
  const resultId = input.ids.uuid();
  const manifestDigest = deriveDryRunScenarioManifestDigest(manifest);
  if (resolution.state === "blocked") {
    const result = DryRunScenarioResultSchema.parse({
      resultId,
      scenarioId: manifest.scenarioId,
      workflow: manifest.workflow,
      subjectLabel: scenarioCase.subjectLabel,
      manifestDigest,
      verdict: "blocked",
      execution: { state: "not-started", reason: "subject-unavailable" },
      assertions: [{
        assertionId: "subject-availability",
        verdict: "blocked",
        reason: "subject-unavailable",
      }],
      wallTimeMs: wallTimeMs(input.clock, startedAt),
      recordedAt: input.clock.now().toISOString(),
    });
    input.persistResult(result);
    return Object.freeze({
      verdict: "blocked",
      exitCode: 2,
      resultId,

      output: `${resolution.reason}\nresult: ${resultId}`,
    });
  }

  const runtime = input.createRuntime();
  let started: DryRunScenarioStarted | undefined;
  let assertions: readonly AssertionOutcome[];
  try {
    started = DryRunScenarioStartedSchema.parse(await runtime.start({
      manifest,
      scenarioCase,
      canonicalInput: resolution.canonicalInput,
      ...(resolution.protectedBindings === undefined ? {} : { protectedBindings: resolution.protectedBindings }),
    }));
    await runtime.drain(manifest.workflow);
    if (scenarioCase.gateResults.length > 0) {
      await runtime.resolveGate({ manifest, scenarioCase, runId: started.runId });
      await runtime.drain(manifest.workflow);
    }
    const evidence = await runtime.collectEvidence(started.runId);
    assertions = evaluateDryRunScenarioEvidence(
      manifest.arm,
      scenarioCase,
      started.writeSafetyBefore,
      evidence,
    );
  } catch (error) {
    if (started !== undefined) {
      const failed = DryRunScenarioResultSchema.parse({
        resultId,
        scenarioId: manifest.scenarioId,
        workflow: manifest.workflow,
        subjectLabel: scenarioCase.subjectLabel,
        manifestDigest,
        verdict: "failed",
        execution: { state: "started", arm: manifest.arm, runId: started.runId, traceId: started.traceId },
        assertions: [{
          assertionId: "runner-execution",
          verdict: "failed",
          reason: "execution-error",
        }],
        wallTimeMs: wallTimeMs(input.clock, startedAt),
        recordedAt: input.clock.now().toISOString(),
      });
      try {
        input.persistResult(failed);
      } catch {
        throw new Error(
          `dry-run scenario execution failed after start and failed evidence could not be persisted for ${manifest.workflow}/${scenarioCase.subjectLabel}`,
        );
      }
      throw new Error(
        `dry-run scenario execution failed after start; failed result ${resultId} records ${manifest.workflow}/${scenarioCase.subjectLabel}`,
        { cause: error },
      );
    }
    throw new Error(
      `dry-run scenario failed before run identity was known for ${manifest.workflow}/${scenarioCase.subjectLabel}`,
      { cause: error },
    );
  }
  const verdict = assertions.every((outcome) => outcome.verdict === "met") ? "met" : "failed";
  const result = DryRunScenarioResultSchema.parse({
    resultId,
    scenarioId: manifest.scenarioId,
    workflow: manifest.workflow,
    subjectLabel: scenarioCase.subjectLabel,
    manifestDigest,
    verdict,
    execution: { state: "started", arm: manifest.arm, runId: started.runId, traceId: started.traceId },
    assertions,
    wallTimeMs: wallTimeMs(input.clock, startedAt),
    recordedAt: input.clock.now().toISOString(),
  });
  input.persistResult(result);
  return Object.freeze({
    verdict,
    exitCode: verdict === "met" ? 0 : 1,
    resultId,
    output: `${verdict}: ${manifest.workflow}/${scenarioCase.caseId} (${scenarioCase.subjectLabel})\nresult: ${resultId}`,
  });
}
