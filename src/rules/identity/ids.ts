import { z } from "zod";

function brandedText<Name extends string>(pattern: RegExp, description: string) {
  return z.string().regex(pattern, description).brand<Name>();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A named slug id with two impersonations refused: a lowercase UUID cannot be spelled as another id kind, and a bare ordinal is a position wearing a name. */
export function slugSchema(description: string) {
  return z.string()
    .regex(SLUG_PATTERN, description)
    .refine((value) => !UUID_PATTERN.test(value), `${description} and must not be a UUID`)
    .refine((value) => !/^\d+$/.test(value), `${description} and must not be a bare ordinal`);
}

function slugText<Name extends string>(description: string) {
  return slugSchema(description).brand<Name>();
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
/** A dashboard-started group of runs. */
export const RunSessionIdSchema = brandedText<"RunSessionId">(UUID_PATTERN, "run session id must be a UUID");
export const VersionPlanIdSchema = brandedText<"VersionPlanId">(UUID_PATTERN, "version plan id must be a UUID");
export const VersionBumpApplicationIdSchema = brandedText<"VersionBumpApplicationId">(
  UUID_PATTERN,
  "version bump application id must be a UUID",
);
export const CommandAuditIdSchema = brandedText<"CommandAuditId">(UUID_PATTERN, "command audit id must be a UUID");
export const OutboxIdSchema = brandedText<"OutboxId">(UUID_PATTERN, "outbox id must be a UUID");
export const WriteIntentIdSchema = brandedText<"WriteIntentId">(UUID_PATTERN, "write intent id must be a UUID");
export const WriteAttemptIdSchema = brandedText<"WriteAttemptId">(UUID_PATTERN, "write attempt id must be a UUID");
export const RowRejectIdSchema = brandedText<"RowRejectId">(UUID_PATTERN, "row reject id must be a UUID");

/** A detected source column's identity: the header AND its occurrence, never the position, so duplicates stay distinct and the id survives a reordered export. */
export const SourceColumnIdSchema = brandedText<"SourceColumnId">(
  /^[A-Za-z0-9_-]{8,}$/,
  "source column id must be base64url text derived from the header and its occurrence",
);

/** A stable target-field path inside a workflow's intake projection; dotted camelCase, with array indices refused so a binding names a declared field, never a slot. */
export const IntakeTargetFieldIdSchema = brandedText<"IntakeTargetFieldId">(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "intake target field id must be a dotted camelCase path",
);

/** Bind document identity to source/page/form; structural IDs cannot masquerade as run/index IDs. */
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
/** The identity that holds a ledger partition's projection lease (ref write-safety ). */
export const LedgerProjectorIdSchema = slugText<"LedgerProjectorId">("ledger projector id must be kebab-case");

/** `<code>-<HHMMSS>-<runId4>`; the code segment is deliberately wider than the writer's current rule because this schema is a READER of durable stored ids. */
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
export const EID_PATTERN = /^10\d{6}$/;
export const EidSchema = brandedText<"Eid">(EID_PATTERN, "EID must be eight digits beginning with 10");
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
]);

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
export type RunSessionId = z.infer<typeof RunSessionIdSchema>;
export type VersionPlanId = z.infer<typeof VersionPlanIdSchema>;
export type VersionBumpApplicationId = z.infer<typeof VersionBumpApplicationIdSchema>;
export type CommandAuditId = z.infer<typeof CommandAuditIdSchema>;
export type OutboxId = z.infer<typeof OutboxIdSchema>;
export type WriteIntentId = z.infer<typeof WriteIntentIdSchema>;
export type WriteAttemptId = z.infer<typeof WriteAttemptIdSchema>;
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
export type TaskStoreId = z.infer<typeof TaskStoreIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
