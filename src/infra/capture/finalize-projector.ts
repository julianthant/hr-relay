/**
 * The capture finalize projector (doc 06 §5.1, D167): pending outbox →
 * bundle → content-addressed publish → ONE authority transaction recording
 * the final artifact, the handoff identities, the outbox settlement, and the
 * session's terminal state. It can never return success and silently lose
 * the handoff — legacy's actual recorded failure.
 *
 * Crash windows, each fail-closed:
 * - after the bundle/publish, before the transaction — the replay bundles
 *   again (the bundler contract is DETERMINISTIC for the same ordered photo
 *   set), the content-addressed put converges by digest, and the one
 *   transaction runs once;
 * - a handoff that throws INSIDE the transaction rolls the whole settlement
 *   back and the failure arm records `failed` durably — session and outbox
 *   together — so the operator sees Retry Finalize, never a phantom "Sent".
 *
 * The bundler and the handoff enqueue are SEAMS: the photos→PDF library and
 * the intake-manifest/run enqueue wiring belong to the 2i capture surface;
 * what this projector owns is the durability protocol around them.
 */
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { ArtifactRef } from "../../domain/artifacts.js";
import {
  CaptureFinalizationOutboxSchema,
  CaptureSessionSchema,
  type CaptureFinalizationOutbox,
} from "../../domain/capture.js";
import type { Clock } from "../../domain/clock.js";

export interface CaptureBundler {
  /** MUST be deterministic for the same ordered photo set. */
  bundle(outbox: CaptureFinalizationOutbox): Promise<Uint8Array>;
}

export interface CaptureHandoffEnqueue {
  /**
   * Runs INSIDE the settlement transaction; idempotent by the outbox's
   * stable key — a replay returns the SAME identities, never a second run.
   */
  enqueue(input: Readonly<{
    outbox: CaptureFinalizationOutbox;
    finalArtifact: ArtifactRef;
  }>): Readonly<{ runId: string; intakeManifestId: string }>;
}

export interface CaptureFinalizeProjectorOptions {
  readonly authority: Readonly<{
    captureSessions: Readonly<{
      get(sessionId: string): unknown;
      update(input: unknown): unknown;
    }>;
    captureFinalizationOutboxes: Readonly<{
      listPending(): readonly CaptureFinalizationOutbox[];
      settle(input: unknown): unknown;
    }>;
  }>;
  readonly withAuthorityTransaction: <Result>(work: () => Result) => Result;
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "put">;
  readonly bundler: CaptureBundler;
  readonly handoff: CaptureHandoffEnqueue;
  readonly ids: Readonly<{ uuid(): string }>;
  readonly clock: Clock;
}

export interface CaptureFinalizeReport {
  readonly finalized: readonly string[];
  readonly failed: readonly Readonly<{ outboxId: string; failureId: string; message: string }>[];
}

export function createCaptureFinalizeProjector(options: CaptureFinalizeProjectorOptions): Readonly<{
  projectPending(): Promise<CaptureFinalizeReport>;
}> {
  return Object.freeze({
    async projectPending(): Promise<CaptureFinalizeReport> {
      const finalized: string[] = [];
      const failed: { outboxId: string; failureId: string; message: string }[] = [];
      for (const outbox of options.authority.captureFinalizationOutboxes.listPending()) {
        const session = CaptureSessionSchema.parse(
          options.authority.captureSessions.get(String(outbox.sessionId)),
        );
        if (session.finalizationGeneration !== outbox.generation) {
          throw new Error(
            `capture outbox ${String(outbox.outboxId)} carries generation ${String(outbox.generation)} but `
            + `session ${String(outbox.sessionId)} is at ${String(session.finalizationGeneration)}; a `
            + "superseded outbox must have been settled before a new generation was minted",
          );
        }
        const now = options.clock.now().toISOString();
        try {
          const bytes = await options.bundler.bundle(outbox);
          const finalArtifact = await options.artifacts.put(bytes, { mediaType: "application/pdf" });
          options.withAuthorityTransaction(() => {
            const identities = options.handoff.enqueue({ outbox, finalArtifact });
            options.authority.captureFinalizationOutboxes.settle(CaptureFinalizationOutboxSchema.parse({
              ...outbox,
              state: "done",
              finalArtifact,
              runId: identities.runId,
              intakeManifestId: identities.intakeManifestId,
              settledAt: now,
            }));
            options.authority.captureSessions.update(CaptureSessionSchema.parse({
              ...session,
              state: "finalized",
              finalArtifact,
              handoff: {
                state: "enqueued",
                runId: identities.runId,
                intakeManifestId: identities.intakeManifestId,
              },
              version: session.version + 1,
            }));
          });
          finalized.push(String(outbox.outboxId));
        } catch (error) {
          const failureId = options.ids.uuid();
          const message = error instanceof Error ? error.message : String(error);
          options.withAuthorityTransaction(() => {
            options.authority.captureFinalizationOutboxes.settle(CaptureFinalizationOutboxSchema.parse({
              ...outbox,
              state: "failed",
              failureId,
              settledAt: now,
            }));
            options.authority.captureSessions.update(CaptureSessionSchema.parse({
              ...session,
              state: "failed",
              // The reason is recorded DURABLY, not merely reported: the phone
              // reads this row to decide between Retry and Discard, and the
              // report below is gone the moment this call returns.
              handoff: { state: "failed", failureId, message },
              version: session.version + 1,
            }));
          });
          failed.push({ outboxId: String(outbox.outboxId), failureId, message });
        }
      }
      return Object.freeze({ finalized: Object.freeze(finalized), failed: Object.freeze(failed) });
    },
  });
}
