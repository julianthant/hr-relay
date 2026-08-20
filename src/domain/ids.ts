import { z } from "zod";

function brandedText<Name extends string>(pattern: RegExp, description: string) {
  return z.string().regex(pattern, description).brand<Name>();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A named slug id, with two impersonations refused.
 *
 * A lowercase UUID satisfies `SLUG_PATTERN` character for character, so without
 * the first refusal a run id could be spelled as a worker id, an actor, or a
 * node — exactly the substitution ref dashboard-surfaces §1.1 rules out when it says workers
 * "never receive a synthetic run id".
 *
 * An all-digit slug likewise parses, and an id that is only digits is a
 * position wearing a name: `nodeId: "3"` says where a node sat, not which node
 * it is. `step-3` and `i9` stay legal; only the bare ordinal is refused.
 */
function slugText<Name extends string>(description: string) {
  return z.string()
    .regex(SLUG_PATTERN, description)
    .refine((value) => !UUID_PATTERN.test(value), `${description} and must not be a UUID`)
    .refine((value) => !/^\d+$/.test(value), `${description} and must not be a bare ordinal`)
    .brand<Name>();
}

export const RunIdSchema = brandedText<"RunId">(UUID_PATTERN, "run id must be a UUID");
export const ItemIdSchema = brandedText<"ItemId">(UUID_PATTERN, "item id must be a UUID");
export const CommandIdSchema = brandedText<"CommandId">(UUID_PATTERN, "command id must be a UUID");
export const FailureIdSchema = brandedText<"FailureId">(UUID_PATTERN, "failure id must be a UUID");
export const EvidenceReceiptIdSchema = brandedText<"EvidenceReceiptId">(UUID_PATTERN, "receipt id must be a UUID");
export const DiagnosticBundleIdSchema = brandedText<"DiagnosticBundleId">(UUID_PATTERN, "bundle id must be a UUID");
export const ConfigSnapshotIdSchema = brandedText<"ConfigSnapshotId">(UUID_PATTERN, "config snapshot id must be a UUID");
export const ArtifactIdSchema = brandedText<"ArtifactId">(UUID_PATTERN, "artifact id must be a UUID");
export const EvidenceEntryIdSchema = brandedText<"EvidenceEntryId">(
  UUID_PATTERN,
  "evidence entry id must be a UUID",
);
const QUALIFIED_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
export const ElementIdSchema = brandedText<"ElementId">(QUALIFIED_ID_PATTERN, "element id must be dot-qualified kebab-case");
export const PageStateIdSchema = brandedText<"PageStateId">(QUALIFIED_ID_PATTERN, "page-state id must be dot-qualified kebab-case");
export const ScreenIdSchema = brandedText<"ScreenId">(QUALIFIED_ID_PATTERN, "screen id must be dot-qualified kebab-case");
export const ObservationIdSchema = brandedText<"ObservationId">(
  QUALIFIED_ID_PATTERN,
  "observation id must be dot-qualified kebab-case",
);
export const ScenarioIdSchema = brandedText<"ScenarioId">(
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/,
  "scenario id must be a slash-delimited kebab-case path",
);
export const KnowledgeIdSchema = brandedText<"KnowledgeId">(UUID_PATTERN, "knowledge id must be a UUID");
export const FixIdSchema = brandedText<"FixId">(UUID_PATTERN, "fix id must be a UUID");
export const NoteIdSchema = brandedText<"NoteId">(UUID_PATTERN, "note id must be a UUID");
export const ReviewRecordIdSchema = brandedText<"ReviewRecordId">(UUID_PATTERN, "review record id must be a UUID");
export const NotificationIdSchema = brandedText<"NotificationId">(UUID_PATTERN, "notification id must be a UUID");
export const WriteBindingProofIdSchema = brandedText<"WriteBindingProofId">(
  UUID_PATTERN,
  "write-binding proof id must be a UUID",
);
export const LeaseIdSchema = brandedText<"LeaseId">(UUID_PATTERN, "lease id must be a UUID");
export const DependencyIdSchema = brandedText<"DependencyId">(UUID_PATTERN, "dependency id must be a UUID");
export const DelegationManifestIdSchema = brandedText<"DelegationManifestId">(
  UUID_PATTERN,
  "delegation manifest id must be a UUID",
);
export const StartPlanIdSchema = brandedText<"StartPlanId">(UUID_PATTERN, "start plan id must be a UUID");
export const IntakeSessionIdSchema = brandedText<"IntakeSessionId">(UUID_PATTERN, "intake session id must be a UUID");
export const IntakeManifestIdSchema = brandedText<"IntakeManifestId">(UUID_PATTERN, "intake manifest id must be a UUID");
export const BrowserSessionIdSchema = brandedText<"BrowserSessionId">(UUID_PATTERN, "browser session id must be a UUID");
export const CaptureSessionIdSchema = brandedText<"CaptureSessionId">(UUID_PATTERN, "capture session id must be a UUID");
export const CapturePhotoIdSchema = brandedText<"CapturePhotoId">(UUID_PATTERN, "capture photo id must be a UUID");
export const VersionPlanIdSchema = brandedText<"VersionPlanId">(UUID_PATTERN, "version plan id must be a UUID");
export const VersionBumpApplicationIdSchema = brandedText<"VersionBumpApplicationId">(
  UUID_PATTERN,
  "version bump application id must be a UUID",
);
export const CommandAuditIdSchema = brandedText<"CommandAuditId">(UUID_PATTERN, "command audit id must be a UUID");
export const OutboxIdSchema = brandedText<"OutboxId">(UUID_PATTERN, "outbox id must be a UUID");
export const WriteIntentIdSchema = brandedText<"WriteIntentId">(UUID_PATTERN, "write intent id must be a UUID");
export const WriteAttemptIdSchema = brandedText<"WriteAttemptId">(UUID_PATTERN, "write attempt id must be a UUID");
export const ProviderAdmissionIdSchema = brandedText<"ProviderAdmissionId">(
  UUID_PATTERN,
  "provider admission id must be a UUID",
);
export const RowRejectIdSchema = brandedText<"RowRejectId">(UUID_PATTERN, "row reject id must be a UUID");

/**
 * A detected source column's identity — ref data-intake-and-edit-data §2.1's
 * `base64url(canonicalJson({ normalizedHeader, occurrence }))`.
 *
 * It is deliberately NOT the header text and NOT the column position. A raw
 * header cannot distinguish two `Name` columns; a position silently rebinds to
 * whatever column slid into that slot when the operator inserted one. Encoding
 * the pair keeps duplicates distinct and keeps the id stable across a
 * reordered export, which is the whole point of ref data-intake-and-edit-data §2.3's reuse scheme.
 *
 * `src/domain/intake/mapping.ts` owns the derivation; this schema owns the
 * shape so a hand-written string cannot be passed where a derived id belongs.
 */
export const SourceColumnIdSchema = brandedText<"SourceColumnId">(
  /^[A-Za-z0-9_-]{8,}$/,
  "source column id must be base64url text derived from the header and its occurrence",
);

/**
 * A stable target-field path inside a workflow's intake projection — the key
 * an operator binds a column TO (`emplId`, `emergencyContact.city`).
 *
 * Dotted camelCase, because it addresses a path in a zod object rather than a
 * kebab-case registry id. Array indices are refused: a binding must name a
 * field the projection declares, never a positional slot inside one.
 */
export const IntakeTargetFieldIdSchema = brandedText<"IntakeTargetFieldId">(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "intake target field id must be a dotted camelCase path",
);

/**
 * A record's identity inside an extracted document — derived at admission from
 * the source-artifact digest plus stable page/form identity (ref dashboard-surfaces §4.1). The
 * shape is deliberately structural so an array index or a run id cannot be
 * spelled as one.
 */
export const StableRecordIdSchema = brandedText<"StableRecordId">(
  /^[0-9a-f]{64}#[a-z0-9]+(?:-[a-z0-9]+)*#[1-9]\d*$/,
  "stable record id must be <source-sha256>#<form-slug>#<page>",
);
export const PredicateIdSchema = slugText<"PredicateId">("predicate id must be kebab-case");

export const WorkflowIdSchema = slugText<"WorkflowId">("workflow id must be kebab-case");
export const ActorIdSchema = slugText<"ActorId">("actor id must be kebab-case");
export const LOCAL_OPERATOR_ACTOR_ID = ActorIdSchema.parse("local-operator");
export const LocalOperatorActorSchema = z.strictObject({
  id: z.literal(LOCAL_OPERATOR_ACTOR_ID),
  label: z.string().min(1),
});
export const NodeIdSchema = slugText<"NodeId">("node id must be kebab-case");
export const ScenarioAssertionIdSchema = slugText<"ScenarioAssertionId">("assertion id must be kebab-case");
export const SourceSurfaceIdSchema = slugText<"SourceSurfaceId">("source surface id must be kebab-case");
export const WorkerIdSchema = slugText<"WorkerId">("worker id must be kebab-case");
export const GateIdSchema = slugText<"GateId">("gate id must be kebab-case");
export const DelegationEdgeIdSchema = slugText<"DelegationEdgeId">("delegation edge id must be kebab-case");
/** The identity that holds a ledger partition's projection lease (ref write-safety §6). */
export const LedgerProjectorIdSchema = slugText<"LedgerProjectorId">("ledger projector id must be kebab-case");

/**
 * `<code>-<HHMMSS>-<runId4>` — the workflow's short code, the minute of the
 * day it was planned, and four bytes of its run id.
 *
 * The code segment is DELIBERATELY wider than what a descriptor may declare
 * today (`WorkflowCodeSchema`: two to four lowercase LETTERS, D242). This
 * schema parses durable stored ids — every run row, span, note line and ledger
 * entry this program has written carries one — so it is a READER, and a reader
 * that narrowed to the writer's current rule would refuse history the moment
 * the rule moved. Two-character alphanumeric codes were the rule until D242,
 * so `[a-z0-9]{2,4}` is exactly "every code that was ever legal"; the writer
 * stays strict at its own declaration site, which is where a new code is
 * chosen and where a wrong one can still be refused.
 */
export const TraceIdSchema = brandedText<"TraceId">(
  /^[a-z0-9]{2,4}-(?:[01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]-[0-9a-f]{4}$/,
  "trace id must be <code>-<HHMMSS>-<runId4>",
);
export const FingerprintSchema = brandedText<"Fingerprint">(/^[0-9a-f]{64}$/, "fingerprint must be SHA-256 hex");
export const FailureFingerprintSchema = FingerprintSchema.brand<"FailureFingerprint">();
export const EvidenceRefSchema = brandedText<"EvidenceRef">(
  /^(?:artifact|observation|receipt):[0-9a-f-]{36}$/i,
  "evidence ref must name a typed UUID-backed evidence record",
);
export const FixtureRefSchema = brandedText<"FixtureRef">(
  /^fixtures\/[a-z0-9/_-]+\.[a-z0-9]+$/,
  "fixture ref must be a relative fixtures path",
);
export const ErrorCodeSchema = brandedText<"ErrorCode">(
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
  "error code must be SCREAMING_SNAKE_CASE",
);
export const IsoInstantSchema = z.iso.datetime({ offset: true }).brand<"IsoInstant">();
export const DateOnlySchema = z.iso.date().brand<"DateOnly">();
export const LocalDateSchema = z.iso.date().brand<"LocalDate">();
export const EidSchema = brandedText<"Eid">(/^10\d{6}$/, "EID must be eight digits beginning with 10");
export const PositiveIntSchema = z.number().int().positive().brand<"PositiveInt">();
export const NonNegativeIntSchema = z.number().int().nonnegative().brand<"NonNegativeInt">();
export const MoneyMinorUnitsSchema = z.number().int().brand<"MoneyMinorUnits">();
export const ProjectionCursorSchema = brandedText<"ProjectionCursor">(
  /^pc:[1-9]\d*$/,
  "projection cursor must be pc:<positive integer>",
);

export const BrowserSystemIdSchema = z.enum([
  "ucpath",
  "crm",
  "onbase",
  "kuali",
  "servicenow",
  "i9",
  "new-kronos",
  "old-kronos",
  "sharepoint",
]);
export const ServiceSystemIdSchema = z.enum(["extraction", "normalization", "ocr", "roster"]);
export const SystemIdSchema = z.union([BrowserSystemIdSchema, ServiceSystemIdSchema]);
export const ProviderCapabilityIdSchema = z.enum([
  "ocr.extract",
  "geocode.census",
  "geocode.nominatim",
  "ai.advisory",
]);

/**
 * The model families `src/domain/secrets.ts` registers a key family for, named
 * here so an advisory's provenance is a closed vocabulary rather than free
 * text (ref operator-trust §4.4). Only `gemini` composes today; the rest are registered
 * because their keys already are, and a provenance value nothing can produce
 * is refused by the composition root, not by this enum.
 */
export const AiProviderIdSchema = z.enum(["gemini", "groq", "mistral", "open-router", "sambanova"]);
/** A remote model identifier — not a secret, but never free-form prose. */
export const AiModelIdSchema = brandedText<"AiModelId">(
  /^[a-z0-9][a-z0-9._-]{0,63}$/,
  "ai model id must be lowercase alphanumeric with . _ -",
);
/**
 * The closed set of questions an advisory may be asked (ref operator-trust §4.4). It lives
 * beside the capability ids rather than in `trust/advisory.ts` because the
 * provider-admission identity names it too, and the two modules must not
 * import each other.
 */
export const AdvisorySurfaceIdSchema = z.enum(["failure-triage", "contact-normalization"]);

export const TaskStoreIdSchema = z.union([
  SystemIdSchema,
  z.templateLiteral(["workflow:", WorkflowIdSchema]),
]);
export const TaskIdSchema = brandedText<"TaskId">(
  /^(?:(?:ucpath|crm|onbase|kuali|servicenow|i9|new-kronos|old-kronos|sharepoint|extraction|normalization|ocr|roster)|workflow:[a-z0-9]+(?:-[a-z0-9]+)*)\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "task id must be <registered-store>/<kebab-case-operation>",
);

declare const taskIdLiteralBrand: unique symbol;
export type LiteralTaskId<Value extends string> = z.infer<typeof TaskIdSchema> & {
  readonly [taskIdLiteralBrand]: Value;
};

export function taskId<const Value extends string>(value: Value): LiteralTaskId<Value>;
export function taskId(value: string): z.infer<typeof TaskIdSchema> {
  return TaskIdSchema.parse(value);
}

export type RunId = z.infer<typeof RunIdSchema>;
export type ItemId = z.infer<typeof ItemIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type FailureId = z.infer<typeof FailureIdSchema>;
export type EvidenceReceiptId = z.infer<typeof EvidenceReceiptIdSchema>;
export type DiagnosticBundleId = z.infer<typeof DiagnosticBundleIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type EvidenceEntryId = z.infer<typeof EvidenceEntryIdSchema>;
export type ConfigSnapshotId = z.infer<typeof ConfigSnapshotIdSchema>;
export type NotificationId = z.infer<typeof NotificationIdSchema>;
export type WriteBindingProofId = z.infer<typeof WriteBindingProofIdSchema>;
export type LeaseId = z.infer<typeof LeaseIdSchema>;
export type DependencyId = z.infer<typeof DependencyIdSchema>;
export type DelegationManifestId = z.infer<typeof DelegationManifestIdSchema>;
export type StartPlanId = z.infer<typeof StartPlanIdSchema>;
export type IntakeSessionId = z.infer<typeof IntakeSessionIdSchema>;
export type IntakeManifestId = z.infer<typeof IntakeManifestIdSchema>;
export type BrowserSessionId = z.infer<typeof BrowserSessionIdSchema>;
export type CaptureSessionId = z.infer<typeof CaptureSessionIdSchema>;
export type CapturePhotoId = z.infer<typeof CapturePhotoIdSchema>;
export type VersionPlanId = z.infer<typeof VersionPlanIdSchema>;
export type VersionBumpApplicationId = z.infer<typeof VersionBumpApplicationIdSchema>;
export type CommandAuditId = z.infer<typeof CommandAuditIdSchema>;
export type OutboxId = z.infer<typeof OutboxIdSchema>;
export type WriteIntentId = z.infer<typeof WriteIntentIdSchema>;
export type WriteAttemptId = z.infer<typeof WriteAttemptIdSchema>;
export type ProviderAdmissionId = z.infer<typeof ProviderAdmissionIdSchema>;
export type RowRejectId = z.infer<typeof RowRejectIdSchema>;
export type SourceColumnId = z.infer<typeof SourceColumnIdSchema>;
export type IntakeTargetFieldId = z.infer<typeof IntakeTargetFieldIdSchema>;
export type StableRecordId = z.infer<typeof StableRecordIdSchema>;
export type PredicateId = z.infer<typeof PredicateIdSchema>;
export type WorkflowId = z.infer<typeof WorkflowIdSchema>;
export type WorkerId = z.infer<typeof WorkerIdSchema>;
export type NodeId = z.infer<typeof NodeIdSchema>;
export type GateId = z.infer<typeof GateIdSchema>;
export type DelegationEdgeId = z.infer<typeof DelegationEdgeIdSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type ActorId = z.infer<typeof ActorIdSchema>;
export type TraceId = z.infer<typeof TraceIdSchema>;
export type Fingerprint = z.infer<typeof FingerprintSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type ElementId = z.infer<typeof ElementIdSchema>;
export type PageStateId = z.infer<typeof PageStateIdSchema>;
export type ScreenId = z.infer<typeof ScreenIdSchema>;
export type ObservationId = z.infer<typeof ObservationIdSchema>;
export type IsoInstant = z.infer<typeof IsoInstantSchema>;
export type DateOnly = z.infer<typeof DateOnlySchema>;
export type LocalDate = z.infer<typeof LocalDateSchema>;
export type Eid = z.infer<typeof EidSchema>;
export type PositiveInt = z.infer<typeof PositiveIntSchema>;
export type BrowserSystemId = z.infer<typeof BrowserSystemIdSchema>;
export type ServiceSystemId = z.infer<typeof ServiceSystemIdSchema>;
export type SystemId = z.infer<typeof SystemIdSchema>;
export type ProviderCapabilityId = z.infer<typeof ProviderCapabilityIdSchema>;
export type AiProviderId = z.infer<typeof AiProviderIdSchema>;
export type AiModelId = z.infer<typeof AiModelIdSchema>;
export type AdvisorySurfaceId = z.infer<typeof AdvisorySurfaceIdSchema>;
export type TaskStoreId = z.infer<typeof TaskStoreIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
