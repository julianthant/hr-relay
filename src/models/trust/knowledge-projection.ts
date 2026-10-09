/** The pure admission audit and the generated active view; the store is insert-only, and the active view is derived rather than stored. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { KnowledgeIdSchema, SystemIdSchema } from "../../rules/identity/ids.js";
import { FixRecordSchema, KnowledgeRecordSchema, type KnowledgeRecord } from "./knowledge.js";

/** A record with no system scope is shared guidance, not a system's page. */
export const SHARED_KNOWLEDGE_SYSTEM = "shared";

export const KnowledgeAdmissionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("admit"), record: KnowledgeRecordSchema }),
  z.strictObject({
    state: z.literal("refuse"),
    reason: z.enum([
      "duplicate-id",
      "unlinked-duplicate-scope",
      "supersedes-self",
      "supersedes-unknown",
      "supersedes-not-recorded",
    ]),
    detail: z.string().min(1),
    conflicts: z.array(KnowledgeIdSchema),
  }),
]);
export type KnowledgeAdmission = z.infer<typeof KnowledgeAdmissionSchema>;

function scopeKey(record: KnowledgeRecord): string {
  return canonicalJsonStringify(record.scope);
}

function normalizedTitle(record: KnowledgeRecord): string {
  return record.title.trim().toLowerCase().replaceAll(/\s+/gu, " ");
}

/** Two records claim the same scoped rule when their scope is byte-identical AND they either carry the same normalized title or share a regression scenario. */
export function knowledgeRecordsCollide(left: KnowledgeRecord, right: KnowledgeRecord): boolean {
  if (scopeKey(left) !== scopeKey(right)) return false;
  if (normalizedTitle(left) === normalizedTitle(right)) return true;
  const scenarios = new Set<string>(right.regressionScenarios);
  return left.regressionScenarios.some((scenario) => scenarios.has(scenario));
}

/** `existing` must be every recorded knowledge record, not just the active ones: a candidate that supersedes a retired record still has to name a record that really exists. */
export function auditKnowledgeAdmission(input: Readonly<{
  candidate: unknown;
  existing: readonly unknown[];
}>): KnowledgeAdmission {
  const candidate = KnowledgeRecordSchema.parse(input.candidate);
  const existing = input.existing.map((record) => KnowledgeRecordSchema.parse(record));
  const byId = new Map(existing.map((record) => [String(record.id), record]));

  if (byId.has(String(candidate.id))) {
    return KnowledgeAdmissionSchema.parse({
      state: "refuse",
      reason: "duplicate-id",
      detail: `knowledge ${candidate.id} is already recorded`,
      conflicts: [candidate.id],
    });
  }

  const supersedes = candidate.supersedes ?? [];
  if (supersedes.some((id) => id === candidate.id)) {
    return KnowledgeAdmissionSchema.parse({
      state: "refuse",
      reason: "supersedes-self",
      detail: `knowledge ${candidate.id} cannot supersede itself`,
      conflicts: [candidate.id],
    });
  }
  const unknown = supersedes.filter((id) => !byId.has(String(id)));
  if (unknown.length > 0) {
    return KnowledgeAdmissionSchema.parse({
      state: "refuse",
      reason: "supersedes-unknown",
      detail: `knowledge ${candidate.id} supersedes ${unknown.join(", ")}, which is not recorded`,
      conflicts: unknown,
    });
  }

  const declared = new Set<string>(supersedes.map(String));
  const collisions = existing
    .filter((record) => record.status === "active")
    .filter((record) => knowledgeRecordsCollide(candidate, record))
    .filter((record) => !declared.has(String(record.id)));
  if (collisions.length > 0) {
    return KnowledgeAdmissionSchema.parse({
      state: "refuse",
      reason: "unlinked-duplicate-scope",
      detail: `knowledge ${candidate.id} claims the same scoped rule as ${collisions.map(({ id }) => id).join(", ")} without superseding it`,
      conflicts: collisions.map(({ id }) => id),
    });
  }

  return KnowledgeAdmissionSchema.parse({ state: "admit", record: candidate });
}

/** The generated guide's exact content set: `active` records that no recorded record supersedes; superseded, retired, and unverified rows stay queryable in authority. */
export function activeKnowledgeView(recordsInput: readonly unknown[]): readonly KnowledgeRecord[] {
  const records = recordsInput.map((record) => KnowledgeRecordSchema.parse(record));
  const superseded = new Set<string>();
  for (const record of records) {
    for (const id of record.supersedes ?? []) superseded.add(String(id));
  }
  return Object.freeze(records
    .filter((record) => record.status === "active" && !superseded.has(String(record.id)))
    .sort((left, right) => String(left.title).localeCompare(String(right.title))));
}

export const KnowledgeProjectionPageSchema = z.strictObject({
  system: z.union([SystemIdSchema, z.literal(SHARED_KNOWLEDGE_SYSTEM)]),
  path: z.string().min(1),
  markdown: z.string().min(1),
});
export type KnowledgeProjectionPage = z.infer<typeof KnowledgeProjectionPageSchema>;

function renderRecord(record: KnowledgeRecord): string {
  const scope = Object.entries(record.scope)
    .map(([key, value]) => `${key}=\`${String(value)}\``)
    .join(", ");
  return [
    `### ${record.title}`,
    "",
    `- **Scope:** ${scope}`,
    `- **Symptom:** ${record.symptom}`,
    `- **Trigger:** ${record.trigger}`,
    `- **Root cause:** ${record.rootCause}`,
    `- **Invariant:** ${record.invariant}`,
    `- **Fix:** ${record.fix}`,
    `- **Regression scenarios:** ${record.regressionScenarios.join(", ")}`,
    `- **Evidence:** ${record.evidence.join(", ")}`,
    ...(record.verifiedAt === undefined ? [] : [`- **Verified:** ${record.verifiedAt}`]),
    ...(record.sourceCommits === undefined ? [] : [`- **Commits:** ${record.sourceCommits.join(", ")}`]),
    ...(record.supersedes === undefined ? [] : [`- **Supersedes:** ${record.supersedes.join(", ")}`]),
    `- **Record:** \`${record.id}\``,
    "",
  ].join("\n");
}

/** One guide per system, generated from the active view only; the header says so explicitly, because a generated view that looks hand-authored is how a second authority starts. */
export function renderKnowledgeMarkdown(input: Readonly<{
  system: string;
  records: readonly KnowledgeRecord[];
}>): string {
  const system = KnowledgeProjectionPageSchema.shape.system.parse(input.system);
  return [
    `# ${system} — active knowledge`,
    "",
    "Generated from the `knowledge_records` authority table: **active records only**, minus every",
    "record a later record supersedes. Do not edit this file; author a `KnowledgeRecord` instead.",
    "",
    ...(input.records.length === 0
      ? ["_No active knowledge is recorded for this scope yet._", ""]
      : input.records.map(renderRecord)),
  ].join("\n");
}

/** Every generated page, keyed by the system its records scope to. */
export function projectKnowledgePages(recordsInput: readonly unknown[]): readonly KnowledgeProjectionPage[] {
  const active = activeKnowledgeView(recordsInput);
  const bySystem = new Map<string, KnowledgeRecord[]>();
  for (const record of active) {
    const system = record.scope.system === undefined ? SHARED_KNOWLEDGE_SYSTEM : String(record.scope.system);
    const page = bySystem.get(system);
    if (page === undefined) bySystem.set(system, [record]);
    else page.push(record);
  }
  return Object.freeze([...bySystem.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([system, records]) => KnowledgeProjectionPageSchema.parse({
      system,
      path: `knowledge/${system}/KNOWLEDGE.md`,
      markdown: renderKnowledgeMarkdown({ system, records }),
    })));
}

/* ── fix records ─────────────────────────────────────────────────────────── */

export const FixAdmissionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("admit"), record: FixRecordSchema }),
  z.strictObject({
    state: z.literal("refuse"),
    reason: z.enum(["duplicate-id", "unknown-knowledge", "unverified-knowledge"]),
    detail: z.string().min(1),
  }),
]);
export type FixAdmission = z.infer<typeof FixAdmissionSchema>;

/** `status:"verified"` already requires a commit plus non-empty evidence; what the schema cannot check is whether the claimed knowledge actually exists and is itself authority. */
export function auditFixAdmission(input: Readonly<{
  candidate: unknown;
  existingFixes: readonly unknown[];
  knowledge: readonly unknown[];
}>): FixAdmission {
  const candidate = FixRecordSchema.parse(input.candidate);
  const existing = input.existingFixes.map((record) => FixRecordSchema.parse(record));
  if (existing.some((record) => record.id === candidate.id)) {
    return FixAdmissionSchema.parse({
      state: "refuse",
      reason: "duplicate-id",
      detail: `fix ${candidate.id} is already recorded`,
    });
  }
  const knowledge = new Map(input.knowledge
    .map((record) => KnowledgeRecordSchema.parse(record))
    .map((record) => [String(record.id), record]));
  for (const id of candidate.knowledge ?? []) {
    const linked = knowledge.get(String(id));
    if (linked === undefined) {
      return FixAdmissionSchema.parse({
        state: "refuse",
        reason: "unknown-knowledge",
        detail: `fix ${candidate.id} links knowledge ${id}, which is not recorded`,
      });
    }
    if (candidate.status === "verified" && linked.status === "unverified") {
      return FixAdmissionSchema.parse({
        state: "refuse",
        reason: "unverified-knowledge",
        detail: `fix ${candidate.id} is verified but links unverified knowledge ${id}`,
      });
    }
  }
  return FixAdmissionSchema.parse({ state: "admit", record: candidate });
}

/* ── lessons are migration input, never authority ────────────────────────── */

export const AppendedLessonSchema = z.strictObject({
  title: z.string().min(1),
  body: z.string().min(1),
  recordedOn: z.iso.date(),
});

export const LessonTriageSchema = z.strictObject({
  state: z.literal("needs-structure"),
  /** Exactly what the author still owes before a record can exist. */
  missing: z.array(z.enum([
    "scope",
    "symptom",
    "trigger",
    "rootCause",
    "invariant",
    "fix",
    "regressionScenarios",
    "evidence",
  ])).min(1),
  detail: z.string().min(1),
});

/** Lessons are migration input, not the new authority; there is deliberately no arm that returns a record, because a chronological append cannot become active guidance by being reformatted. */
export function triageLesson(input: unknown): z.infer<typeof LessonTriageSchema> {
  const lesson = AppendedLessonSchema.parse(input);
  return LessonTriageSchema.parse({
    state: "needs-structure",
    missing: [
      "scope", "symptom", "trigger", "rootCause", "invariant", "fix", "regressionScenarios", "evidence",
    ],
    detail: `lesson "${lesson.title}" (${lesson.recordedOn}) is prose; author a KnowledgeRecord with a regression scenario and evidence before it can become active guidance`,
  });
}
