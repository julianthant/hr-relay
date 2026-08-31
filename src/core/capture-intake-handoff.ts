/**
 * The capture finalize HANDOFF (ref data-intake-and-edit-data §5.1, D174) — the seam D167 left open.
 *
 * D167 built the durability protocol around this call and deliberately left
 * the destination unwired: "bundle → register → enqueue either succeeds
 * visibly or fails visibly". This module is the enqueue half, and it honours
 * exactly what the seam promises:
 *
 * - it runs INSIDE the finalize projector's settlement transaction, so the
 *   manifest, the run, the outbox settlement and the session's terminal state
 *   are one commit — a handoff that throws rolls all of it back and lands
 *   durable `failed` on both rows;
 * - it is IDEMPOTENT BY STABLE KEY, which is only true if the identities are
 *   derived rather than minted. `ids.uuid()` returns something different every
 *   call, so a replay would promise the same identities and hand back two. The
 *   manifest id and the run id are therefore folded from the outbox's own
 *   `stableKey` (D174) — same bundle, same generation, same ids, forever.
 *
 * ## Why a real workflow still cannot receive one
 *
 * The bundle → canonical-input step is a DECLARED, fingerprinted property of a
 * workflow (`src/domain/capture-intake.ts`), not something this module
 * invents. No registered workflow declares one: their structured identifiers
 * and fields are not derivable from a photograph without an OCR-backed binding
 * that does not exist. So in production this handoff REFUSES BY NAME
 * — the same shape D170 gave intake projections before D172 — and the refusal
 * surfaces to the phone as a durable `failed` with Retry Finalize beside it,
 * never as a silently dropped bundle or a run carrying an invented input.
 */
import type { CaptureFinalizationOutbox } from "../domain/capture.js";
import type { CaptureIntakeBinding } from "../domain/capture-intake.js";
import type { ArtifactRef } from "../domain/artifacts.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { Clock } from "../domain/clock.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import type { CaptureHandoffEnqueue } from "../infra/capture/finalize-projector.js";
import { workflowPlanning } from "../base/workflow.js";
import { canonicalJsonStringify, JsonValueSchema } from "../domain/canonical-json.js";
import { buildIntakeManifest, intakeInputHash } from "../domain/intake/manifest.js";
import { CaptureSessionSchema } from "../domain/capture.js";
import { deriveItemId, deriveStableUuid, deriveTraceId } from "../domain/identifiers.js";
import {
  FingerprintSchema,
  IntakeManifestIdSchema,
  ItemIdSchema,
  RunIdSchema,
} from "../domain/ids.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { sha256Hex } from "../domain/sha256.js";
import { fanOutQueuedRuns } from "./run-fan-out.js";
import { resolveInstances } from "../services/start/plan.js";

export interface CaptureIntakeHandoffOptions {
  /**
   * The SAME repositories object `withAuthorityTransaction` hands out, so
   * every write below joins the projector's open transaction rather than
   * opening one of its own.
   */
  readonly repositories: AuthorityRepositories;
  readonly bindings: Readonly<{ resolve: (workflowId: string) => CaptureIntakeBinding | undefined }>;
  readonly descriptors: Readonly<{ resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined }>;
  /** Proven against the stored snapshot before a single run is stamped (D171). */
  readonly configIdentity: Readonly<{ configFingerprint: string; configSnapshotId: string }>;
  /** The running app build, stamped on the run this handoff enqueues (D179). */
  readonly appVersion: string;
  readonly clock: Clock;
}

/** The manifest's three identity folds, spelled out for a document source. */
function captureManifestIdentities(
  outbox: CaptureFinalizationOutbox,
  finalArtifact: ArtifactRef,
  binding: CaptureIntakeBinding,
): Readonly<{ mappingFingerprint: string; mappingSnapshotHash: string }> {
  const orderedPhotoSha256 = outbox.orderedPhotoArtifacts.map((photo) => String(photo.sha256));
  return Object.freeze({
    // The SOURCE's identity. A spreadsheet's is its header layout; a bundle's
    // is the ordered photographs it was built from plus the document they
    // became — re-photographing the same form is a different source.
    mappingFingerprint: FingerprintSchema.parse(sha256Hex(
      `hrauto:capture-source:v1\0${canonicalJsonStringify({
        bundleSha256: String(finalArtifact.sha256),
        orderedPhotoSha256,
      })}`,
    )),
    // The DECISIONS' identity. A capture operator decides two things — which
    // workflow and which form type — and the binding decides the rest.
    mappingSnapshotHash: FingerprintSchema.parse(sha256Hex(
      `hrauto:capture-decisions:v1\0${canonicalJsonStringify({
        workflow: String(outbox.workflow),
        formType: outbox.formType ?? null,
        bindingFingerprint: String(binding.fingerprint),
      })}`,
    )),
  });
}

export function createCaptureIntakeHandoff(options: CaptureIntakeHandoffOptions): CaptureHandoffEnqueue {
  return Object.freeze({
    enqueue(input: Readonly<{ outbox: CaptureFinalizationOutbox; finalArtifact: ArtifactRef }>) {
      // This method is synchronous and runs inside the projector's settlement
      // transaction. Guard before deriving or inserting the manifest so the
      // current settings generation and every downstream write commit as one
      // authority decision; there is no async crossing inside this method.
      options.repositories.runtimeConfig.requireSettingsCurrent();
      const { outbox, finalArtifact } = input;
      const sessionId = String(outbox.sessionId);
      const workflowId = String(outbox.workflow);

      const session = CaptureSessionSchema.parse(options.repositories.captureSessions.get(sessionId));

      const descriptor = options.descriptors.resolve(workflowId);
      if (descriptor === undefined) {
        throw new Error(
          `capture session ${sessionId} names workflow ${workflowId}, which is not registered; `
          + "the bundle is kept and nothing was enqueued",
        );
      }

      const binding = options.bindings.resolve(workflowId);
      if (binding === undefined) {
        throw new Error(
          `capture session ${sessionId} cannot be handed off: workflow ${workflowId} declares no capture `
          + "intake binding, so there is no declared way to turn a photographed document into its input. "
          + "The bundle is finalized and kept — retry once a workflow declares one.",
        );
      }

      const formType = outbox.formType;
      if (formType === undefined) {
        if (binding.formTypes.length > 0) {
          throw new Error(
            `capture session ${sessionId} declares no form type, but ${workflowId}'s capture intake binding `
            + `accepts only ${binding.formTypes.join(", ")}`,
          );
        }
      } else if (!binding.formTypes.includes(formType)) {
        throw new Error(
          `capture session ${sessionId} declares form type ${formType}, which ${workflowId}'s capture intake `
          + `binding does not accept (it accepts ${binding.formTypes.length === 0 ? "none" : binding.formTypes.join(", ")})`,
        );
      }

      const orderedPhotoSha256 = outbox.orderedPhotoArtifacts.map((photo) => String(photo.sha256));
      let rawInput: unknown;
      try {
        rawInput = binding.build({
          captureSessionId: sessionId,
          workflow: workflowId,
          ...(formType === undefined ? {} : { formType }),
          ...(session.contextHint === undefined ? {} : { contextHint: session.contextHint }),
          document: finalArtifact,
          orderedPhotoSha256,
          finalizationGeneration: outbox.generation,
        });
      } catch (error) {
        throw new Error(
          `capture session ${sessionId}: ${workflowId}'s capture intake binding could not build an input from `
          + "the finalized bundle; nothing was enqueued",
          { cause: error },
        );
      }

      const planning = workflowPlanning(descriptor);
      const parsedIngress = JsonValueSchema.parse(JSON.parse(canonicalJsonStringify(planning.parseInput(rawInput))));
      // D62: the canonical value is re-read through the descriptor's CURRENT
      // canonical schema, never through whatever the binding happened to hand
      // back.
      const canonicalInput = planning.parseCanonicalInput(parsedIngress);
      const canonicalInputSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");

      const matchKey = planning.matchKey(parsedIngress);
      const itemId = ItemIdSchema.parse(deriveItemId(workflowId, matchKey));
      const manifestId = IntakeManifestIdSchema.parse(
        deriveStableUuid("hrauto:capture-manifest:v1", String(outbox.stableKey)),
      );
      const runId = RunIdSchema.parse(
        deriveStableUuid("hrauto:capture-run:v1", String(outbox.stableKey)),
      );
      const now = options.clock.now().toISOString();

      const snapshot = options.repositories.configSnapshots.get(options.configIdentity.configSnapshotId);
      if (snapshot === undefined) {
        throw new Error(
          `capture session ${sessionId} cannot enqueue: authority holds no config snapshot `
          + `${options.configIdentity.configSnapshotId}`,
        );
      }
      if (snapshot.fingerprint !== options.configIdentity.configFingerprint) {
        throw new Error(
          `capture session ${sessionId} cannot enqueue: config snapshot `
          + `${options.configIdentity.configSnapshotId} holds fingerprint ${snapshot.fingerprint.slice(0, 12)}…, `
          + `not the ${options.configIdentity.configFingerprint.slice(0, 12)}… this process resolved`,
        );
      }

      const identities = captureManifestIdentities(outbox, finalArtifact, binding);
      const manifest = buildIntakeManifest({
        manifestId,
        workflow: workflowId,
        source: {
          artifactId: String(finalArtifact.id),
          sha256: String(finalArtifact.sha256),
          // A content-addressed bundle has no operator-given name, so the one
          // it gets NAMES ITS ORIGIN rather than pretending to be a filename
          // somebody typed.
          originalName: `capture-${sessionId}-g${String(outbox.generation)}.pdf`,
        },
        mappingFingerprint: identities.mappingFingerprint,
        mappingSnapshotHash: identities.mappingSnapshotHash,
        intakeProjectionFingerprint: String(binding.fingerprint),
        workflowContractFingerprint: String(descriptor.contractFingerprint),
        canonicalInputSchemaHash,
        createdAt: now,
        capture: {
          captureSessionId: sessionId,
          finalizationGeneration: outbox.generation,
          orderedPhotoSha256,
        },
        sourceRows: 1,
        valid: [{ sourceRow: 1, itemId, inputHash: intakeInputHash(parsedIngress), parsedInput: parsedIngress }],
        currentRejects: new Map(),
        rejectionHistory: [],
        corrections: [],
        exclusions: [],
      });

      // Unlike the intake arm, `existing` is EXPECTED rather than a fault: the
      // id is a fold of the stable key, so a repeat is the same manifest by
      // construction — and the repository already refuses by name if the
      // stored bytes diverge from the rebuild.
      options.repositories.intakeManifests.insert(manifest);

      fanOutQueuedRuns(
        options.repositories,
        (message) => { throw new Error(message); },
        descriptor,
        {
          workflow: workflowId,
          descriptorVersion: descriptor.version,
          contractFingerprint: String(descriptor.contractFingerprint),
          resolvedInstance: resolveInstances(descriptor, undefined),
          // One document is one run, and the operator is standing there
          // holding the phone — so it is `interactive`, not the `bulk` a
          // spreadsheet fan-out is.
          shape: "single",
          priority: "interactive",
          // A capture handoff is never a rehearsal: the operator photographed a
          // real document to have it processed.
          dryRun: false,
          configFingerprint: options.configIdentity.configFingerprint,
          configSnapshotId: options.configIdentity.configSnapshotId,
          ingressSchemaHash: deriveSchemaHash(descriptor.input, "input"),
          appVersion: options.appVersion,
          // D269: a handoff is a group of one. The id is a fold of the SAME
          // stable key the manifest and run ids fold from, so a replay names
          // the same session (D174's "same identities, never a second run");
          // the origin carries no actor because the capture session records
          // none — nobody's id is invented here.
          session: {
            sessionId: deriveStableUuid("hrauto:capture-session:v1", String(outbox.stableKey)),
            origin: { kind: "capture-handoff", captureSessionId: session.sessionId, intakeManifestId: manifestId },
          },
        },
        [{
          runId,
          itemId,
          traceId: deriveTraceId(descriptor.code, runId, options.clock),
          matchKey,
          rawInput: parsedIngress,
          parsedInput: { schemaHash: canonicalInputSchemaHash, value: canonicalInput },
        }],
        now,
        `capture bundle ${manifestId}`,
      );

      return { runId, intakeManifestId: manifestId };
    },
  });
}
