/**
 * The archived run's FROZEN section payloads (D223, ref dashboard-surfaces §10.2).
 *
 * D179 froze the projected row, the detail, the receipt, the failure and the
 * evidence pointers. That left the archived detail rendering two tabs where
 * the surface it was ported from renders five: an archived run's log lines,
 * data points and member rows were not readable AT ALL, because
 * `RunDetailWire` carries COUNTS (`context.dataFacts`, `context.attempts`) and
 * NAMES (`availableSections`) while the section payloads themselves are
 * fetched per request against a LIVE run — and an archived run has no live
 * anything to fetch against.
 *
 * The operator's ruling (2026-08-18, "for the archive stuff just follow how
 * the demo looks") settled it the way charter §25 already implied: an archived
 * run whose logs are unreadable is not "self-contained data", so the sections
 * are FROZEN beside the row, in the same seam that already freezes everything
 * else. Rendering them still resolves nothing — that is the whole property
 * `archive-invariants` reads a stored record back with the descriptor list
 * emptied to prove.
 *
 * ## Every section is an explicit absence union, and none of them is a blank
 *
 * A run with no members and a run whose member rows could not be projected are
 * different facts, and only one of them is a reason to refuse the archive. So
 * every section carries either its payload or the sentence saying why it has
 * none — never an empty array standing in for both.
 *
 * ## Read-forward (D133)
 *
 * This whole block is OPTIONAL on the archived record and is bound to the
 * record's own `archiveSchemaGeneration`: a generation-1 record predates the
 * block, carries none, and says so. Nothing back-fills it — a log line that
 * was never frozen cannot be recovered from a note stream the retention sweep
 * has since taken, and inventing one would be a fabricated record on the one
 * surface whose entire job is to be trustworthy.
 */
import { z } from "zod";
import {
  ArtifactIdSchema,
  DiagnosticBundleIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  PositiveIntSchema,
} from "../../rules/identity/ids.js";
import { ContextDataSectionSchema, NotePageSchema, PeoplePageSchema } from "../dashboard/run-detail.js";

/** A frozen section, or the reason this record has none. */
function frozen<Payload extends z.ZodTypeAny>(payload: Payload) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: payload }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]);
}

/**
 * ONE captured artifact, DESCRIBED.
 *
 * D179's "evidence is pointers only" is about the BYTES, and it stands: the
 * content-addressed content stays exactly where it is and this record copies
 * none of it. What it adds is what a pointer alone could never say — an
 * operator reading `9f2c…` in a chip cannot tell what the capture was OF, when
 * it was taken, or whether its bytes are still there. Every field below is a
 * fact authority already holds about the attachment at archive time, copied
 * verbatim; nothing here is derived from the bytes and nothing reads them.
 *
 * `step` and `system` are unions rather than strings because a diagnostic
 * bundle records neither directly. A bundle raised BY a failure can be dated
 * to that failure's node and task, and a bundle an operator requested cannot —
 * so the second one says so instead of borrowing the run's last node, which
 * would attach a capture to a step it may not belong to.
 */
export const ArchivedCaptureTileSchema = z.strictObject({
  artifactId: ArtifactIdSchema,
  bundleId: DiagnosticBundleIdSchema,
  kind: z.enum(["screenshot", "accessibility-excerpt", "network-summary", "console-summary"]),
  mediaType: z.enum(["image/png", "image/jpeg", "text/yaml", "application/json"]),
  byteLength: NonNegativeIntSchema,
  digest: FingerprintSchema,
  sensitivity: z.enum(["redacted", "restricted"]),
  /** The instant the BUNDLE was captured — the attachment's own row instant. */
  capturedAt: IsoInstantSchema,
  /** Why the bundle exists at all (ref operator-trust §2.2's closed origin vocabulary). */
  origin: z.enum(["failure", "unexpected-state", "subject-mismatch", "recovery-park", "operator-request"]),
  /** A screenshot's pixel size, so a thumbnail can hold its aspect. */
  dimensions: z.strictObject({ width: PositiveIntSchema, height: PositiveIntSchema }).optional(),
  step: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), nodeId: NodeIdSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  system: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(1) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  /**
   * The bundle's DECLARED retention, frozen — never an observation of whether
   * the bytes are still on disk. Reading the content store from the archived
   * path would break the one property this whole model exists to have, and a
   * "purged" badge derived from a policy plus a clock is a computation the
   * surface does at read time (`archiveRetention`), not a fact to freeze.
   */
  retention: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ordinary"), purgeAfter: IsoInstantSchema }),
    z.strictObject({ kind: z.literal("pinned"), reason: z.enum(["knowledge", "fix", "write-recovery"]) }),
  ]),
});
export type ArchivedCaptureTile = z.infer<typeof ArchivedCaptureTileSchema>;

/** The closed task-span outcome vocabulary, as the projection folds it. */
export const ArchivedAttemptOutcomeSchema = z.enum([
  "done", "failed", "cancelled", "discarded", "skipped", "interrupted", "superseded",
]);

/**
 * ONE run attempt, folded from that attempt's own task spans.
 *
 * The detail could say "1 attempt" and nothing about what each attempt DID: on
 * a run that failed twice before settling, the archive could not show the shape
 * of the retry. Span identity is `(runId, attempt, spanPath)` (ref dashboard-surfaces §1.1,
 * D74's lesson), so the attempt is already the grouping key the fold carries —
 * this is a projection of facts the row holds, not a new authority read.
 *
 * There is deliberately no per-attempt trace id and no per-attempt status
 * PILL. A trace id belongs to the run, not to an attempt inside it, and a
 * "status" for an attempt would have to be invented from the span mix — so the
 * mix is served verbatim and the surface counts it. `unfinished` is spans with
 * no folded outcome, which on any attempt but the last means the process died
 * mid-step, and that is a fact worth showing rather than rounding to zero.
 */
export const ArchivedRunAttemptSchema = z.strictObject({
  attempt: PositiveIntSchema,
  steps: NonNegativeIntSchema,
  startedAt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  endedAt: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: IsoInstantSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]),
  outcomes: z.array(z.strictObject({
    outcome: ArchivedAttemptOutcomeSchema,
    count: PositiveIntSchema,
  })),
  unfinished: NonNegativeIntSchema,
}).superRefine((attempt, context) => {
  const counted = attempt.outcomes.reduce((total, entry) => total + entry.count, 0) + attempt.unfinished;
  if (counted !== attempt.steps) {
    context.addIssue({
      code: "custom",
      path: ["outcomes"],
      message: `attempt ${String(attempt.attempt)} folds ${String(counted)} spans but reports ${String(attempt.steps)} steps`,
    });
  }
  const kinds = attempt.outcomes.map(({ outcome }) => outcome);
  if (new Set(kinds).size !== kinds.length) {
    context.addIssue({ code: "custom", path: ["outcomes"], message: "an outcome is counted twice in one attempt" });
  }
});
export type ArchivedRunAttempt = z.infer<typeof ArchivedRunAttemptSchema>;

/**
 * The four sections the PROJECTION owns, taken through the same
 * `ArchiveSnapshotSource` seam as the row and the detail — so the frozen bytes
 * are the bytes the operator last saw rather than a second derivation of them.
 */
export const ArchivedProjectionSectionsSchema = z.strictObject({
  /**
   * EVERY note line, not the first page. The live section is paged because a
   * running run's log grows; an archived one is finished, and a frozen page
   * with a live-looking `nextCursor` would advertise a fetch the archive has
   * no endpoint for. The cursor is therefore always `end-of-page`, and the
   * freeze refuses rather than truncating if the stream will not end.
   */
  logs: frozen(NotePageSchema),
  data: frozen(ContextDataSectionSchema),
  people: frozen(PeoplePageSchema),
  attempts: frozen(z.array(ArchivedRunAttemptSchema).min(1)),
});
export type ArchivedProjectionSections = z.infer<typeof ArchivedProjectionSectionsSchema>;

/** The frozen sections as the archived record stores them. */
export const ArchivedRunSectionsSchema = z.strictObject({
  ...ArchivedProjectionSectionsSchema.shape,
  captures: frozen(z.array(ArchivedCaptureTileSchema).min(1)),
});
export type ArchivedRunSections = z.infer<typeof ArchivedRunSectionsSchema>;
