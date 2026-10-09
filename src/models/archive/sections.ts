/** The archived run's frozen section payloads, frozen beside the row so an archived run stays self-contained and renders with no descriptor. */
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

/** ONE captured artifact, described: facts authority holds about the attachment, and none of the bytes. */
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
    /* The bundle's DECLARED retention, frozen — never an observation of whether the bytes are still on disk. */
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

/** ONE run attempt, folded from that attempt's own task spans and served verbatim, with no invented status. */
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

/** The four sections the projection owns, taken through the same `ArchiveSnapshotSource` seam as the row and the detail. */
export const ArchivedProjectionSectionsSchema = z.strictObject({
    /* EVERY note line, not the first page: an archived run is finished, so the cursor is always `end-of-page` and the freeze refuses rather than truncating. */
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
