/**
 * Optional AI assistance reads complete supplied evidence and cannot change authority.
 * Every prompt leaf has a declared classification; undeclared leaves fail loudly.
 * The closed answer schema travels with the question. Provider and parsing failures
 * remain typed absence, and advisory wiring cannot reach mutation services.
 */
import { z } from "zod";
import { JsonValueSchema, canonicalJsonStringify } from "../canonical-json.js";
import { ContactAdviceSchema } from "../normalization/contact-rules.js";
import {
  AdvisorySurfaceIdSchema,
  AiModelIdSchema,
  AiProviderIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  type AdvisorySurfaceId,
} from "../ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  RedactedFieldSchema,
  evidenceTransformAllowed,
  redactValue,
  redactionDigest,
} from "../redaction.js";
import { deriveSchemaHash } from "../schema-bound-value.js";
import { FailureRecordSchema } from "./failure.js";

/* ── 1. the declaration ───────────────────────────────────────────────────── */

/** `EvidenceLeafPathSchema`'s grammar — one vocabulary for field paths. */
export const AdvisoryLeafPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "advisory leaf path must be a dot-delimited camelCase object path",
);

export const AdvisoryFieldClassificationSchema = z.strictObject({
  path: AdvisoryLeafPathSchema,
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
}).superRefine((entry, context) => {
  if (!evidenceTransformAllowed(entry.classification, entry.transform)) {
    context.addIssue({
      code: "custom",
      path: ["transform"],
      message: `${entry.transform} is forbidden for ${entry.classification}`,
    });
  }
});
export type AdvisoryFieldClassification = z.infer<typeof AdvisoryFieldClassificationSchema>;

/** `safe-diagnostic` + `allow` — a fact about the TRANSACTION, not the person. */
function open(...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ path, classification: "safe-diagnostic", transform: "allow" }));
}

/** Complete supplied failure prose retains its sensitive-HR classification. */
function sensitive(...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ path, classification: "sensitive-hr", transform: "allow" }));
}

/** Complete supplied URLs, titles and display values retain their identifier classification. */
function person(...paths: readonly string[]): unknown[] {
  return paths.map((path) => ({ path, classification: "direct-identifier", transform: "allow" }));
}

/**
 * Every leaf a `FailureRecord` can present, classified. Completeness is
 * enforced two ways: `buildAdvisoryFacts` refuses an undeclared path at
 * runtime, and `advisory-no-authority` walks a maximal failure fixture so a
 * field added to `FailureRecordSchema` fails this table rather than shipping
 * unclassified.
 */
export const FAILURE_TRIAGE_CLASSIFICATIONS = Object.freeze(
  AdvisoryFieldClassificationSchema.array().parse([
    ...open(
      "failureId", "fingerprint", "runId", "traceId", "attempt", "workflowId",
      "nodeId", "taskId", "code", "transient", "writeState", "occurredAt",
      "diagnosticBundleId",
      "causeChain.code", "causeChain.role", "causeChain.transient",
      "remediation.kind",
      "subject.expected.kind", "subject.expected.digest",
      "subject.observed.kind", "subject.observed.digest",
      "subject.proofRef",
      "page.screen", "page.state",
      "action.elementId", "action.operation", "action.sequence",
    ),
    ...sensitive("summary", "causeChain.summary", "remediation.message"),
    ...person(
      "subject.expected.displayRedacted",
      "subject.observed.displayRedacted",
      "page.urlRedacted",
      "page.titleRedacted",
    ),
  ]),
);

const FAILURE_TRIAGE_BY_PATH = new Map(
  FAILURE_TRIAGE_CLASSIFICATIONS.map((entry) => [entry.path, entry] as const),
);

export const ADVISORY_CLASSIFICATIONS: Readonly<
  Record<AdvisorySurfaceId, ReadonlyMap<string, AdvisoryFieldClassification>>
> = Object.freeze({
  "failure-triage": FAILURE_TRIAGE_BY_PATH,
  // The contact surface classifies through `CANONICAL_FIELDS`, which already
  // declares (classification, redactTransform) per field and is the ONE place
  // an intake column's handling is decided. A second table here would be a
  // second answer to the same question.
  "contact-normalization": new Map<string, AdvisoryFieldClassification>(),
});

/* ── 2. the prompt ────────────────────────────────────────────────────────── */

export const AdvisoryPromptSchema = z.strictObject({
  surface: AdvisorySurfaceIdSchema,
  templateVersion: z.number().int().positive(),
  instruction: z.string().min(1),
  /** The closed advice schema's own JSON-Schema projection. */
  answerSchema: JsonValueSchema,
  answerSchemaFingerprint: FingerprintSchema,
  /** Classified complete values; historical redacted arms remain readable. */
  facts: z.array(RedactedFieldSchema).min(1),
});
export type AdvisoryPrompt = z.infer<typeof AdvisoryPromptSchema>;

export const ADVISORY_PROMPT_SCHEMA_HASH = deriveSchemaHash(AdvisoryPromptSchema, "input");

/**
 * The advisory leaf walk (see the header note on why it is finer than the
 * receipt's): an object recurses, an array of objects recurses per element
 * under the ARRAY's path so every element field shares one declaration, and
 * everything else is a leaf.
 */
type AdvisoryJsonValue = z.infer<typeof JsonValueSchema>;

/** `Array.isArray` widens a `readonly T[]` to `any[]`; this narrowing does not. */
function isJsonArray(value: AdvisoryJsonValue): value is readonly AdvisoryJsonValue[] {
  return Array.isArray(value);
}

function advisoryLeaves(
  value: AdvisoryJsonValue,
  prefix: string,
): readonly (readonly [string, AdvisoryJsonValue])[] {
  if (value === null || typeof value !== "object") return [[prefix, value] as const];
  if (isJsonArray(value)) {
    return value.flatMap((element) => advisoryLeaves(element, prefix));
  }
  const object: Readonly<Record<string, AdvisoryJsonValue>> = value;
  const entries = Object.entries(object)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (entries.length === 0) return [[prefix, value] as const];
  return entries.flatMap(([key, child]) => advisoryLeaves(
    child,
    prefix.length === 0 ? key : `${prefix}.${key}`,
  ));
}

/**
 * Classify one record into the prompt's complete fact list under a surface's declared
 * classifications. An undeclared path is a REFUSAL naming the path and the
 * file that owns it — the "add the declaration" gap, not a value to guess at.
 */
export function buildAdvisoryFacts(
  surface: AdvisorySurfaceId,
  record: unknown,
): readonly z.infer<typeof RedactedFieldSchema>[] {
  const declarations = ADVISORY_CLASSIFICATIONS[surface];
  const facts: z.infer<typeof RedactedFieldSchema>[] = [];
  const seen = new Set<string>();
  // Parsed before the walk, not cast during it: a record that is not canonical
  // JSON cannot be classified, and finding that out one leaf at a time would
  // leave half a prompt built.
  for (const [path, value] of advisoryLeaves(JsonValueSchema.parse(record), "")) {
    const declared = declarations.get(path);
    if (declared === undefined) {
      throw new Error(
        `no declared advisory classification for ${surface} leaf "${path}"; `
        + "add it to src/domain/trust/advisory.ts — a prompt never carries an unreviewed field",
      );
    }
    // One element field per array is enough: `causeChain.code` is declared
    // once, and repeating it per element would put N copies of the same
    // classification on the wire while telling the model nothing new. The
    // VALUES still differ, so each occurrence is kept — only the duplicate
    // path check is per (path, canonical value).
    const key = `${path} ${canonicalJsonStringify(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(RedactedFieldSchema.parse({
      key: path,
      ...redactValue(declared.classification, declared.transform, value),
    }));
  }
  if (facts.length === 0) {
    throw new Error(`advisory surface ${surface} produced no facts; an empty prompt asks nothing`);
  }
  return Object.freeze(facts);
}

/** The digest §4.4 records — over exactly the bytes that leave the process. */
export function advisoryInputDigest(facts: readonly z.infer<typeof RedactedFieldSchema>[]) {
  return redactionDigest(facts);
}

/* ── 3. the closed advice shapes ──────────────────────────────────────────── */

export const AdvisoryConfidenceSchema = z.enum(["low", "medium", "high"]);

/**
 * Failure triage. Deliberately absent: any field that would let the model set
 * retryability, name a remediation KIND from `RemediationActionSchema`, or
 * otherwise be mistaken for the record's own verdict. §4.4: an advisory
 * "cannot set retryability or issue a command", and a strict object with no
 * such key is how that is enforced rather than promised.
 */
export const FailureTriageAdviceSchema = z.strictObject({
  headline: z.string().min(1).max(160),
  explanation: z.string().min(1).max(1200),
  checks: z.array(z.strictObject({
    what: z.string().min(1).max(200),
    why: z.string().min(1).max(200),
  })).min(1).max(5),
  confidence: AdvisoryConfidenceSchema,
});
export type FailureTriageAdvice = z.infer<typeof FailureTriageAdviceSchema>;

export const FAILURE_TRIAGE_ADVICE_SCHEMA_HASH = deriveSchemaHash(FailureTriageAdviceSchema, "output");
export const CONTACT_ADVICE_SCHEMA_HASH = deriveSchemaHash(ContactAdviceSchema, "output");

/* ── 4. the templates ─────────────────────────────────────────────────────── */

/**
 * Deliberately NOT exported and deliberately NOT schema-bound: a template
 * holds a live `z.ZodType`, so it is a compile-time table rather than a
 * boundary value, and `strict-boundary-schemas` is right to demand a schema
 * for anything exported from a domain module.
 */
interface AdvisoryTemplate {
  readonly version: number;
  readonly instruction: string;
  readonly answerSchema: z.ZodType;
  readonly answerSchemaFingerprint: z.infer<typeof FingerprintSchema>;
}

const FAILURE_TRIAGE_INSTRUCTION = [
  "You are helping a human operator understand ONE failed run of an HR automation.",
  "You are given complete supplied facts about the failure, including their declared classifications.",
  "Use only those facts; do not invent identifiers, people, dates or system contents.",
  "Explain what this failure CLASS most likely means and what a human should look at.",
  "You are advisory only: you cannot retry, resolve, approve or change anything, and your",
  "answer is never treated as evidence. If the facts do not support an explanation, say so",
  "in the explanation and answer with low confidence.",
  "Answer with JSON matching the provided schema exactly, and nothing else.",
].join(" ");

const CONTACT_NORMALIZATION_INSTRUCTION = [
  "You are canonicalizing ONE contact record's fields for a US HR system.",
  "You are given the complete supplied fields and their declared data classifications.",
  "Use only those fields; do not ask for or guess additional values.",
  "For each field you are asked about, answer with the canonical value you are confident in,",
  "or omit the field entirely — an omitted field stays with the operator, which is correct.",
  "Do not invent an address, a phone number or a person.",
  "Answer with JSON matching the provided schema exactly, and nothing else.",
].join(" ");

export const ADVISORY_TEMPLATES: Readonly<Record<AdvisorySurfaceId, AdvisoryTemplate>> = Object.freeze({
  "failure-triage": Object.freeze({
    version: 1,
    instruction: FAILURE_TRIAGE_INSTRUCTION,
    answerSchema: FailureTriageAdviceSchema,
    answerSchemaFingerprint: FAILURE_TRIAGE_ADVICE_SCHEMA_HASH,
  }),
  "contact-normalization": Object.freeze({
    version: 1,
    instruction: CONTACT_NORMALIZATION_INSTRUCTION,
    answerSchema: ContactAdviceSchema,
    answerSchemaFingerprint: CONTACT_ADVICE_SCHEMA_HASH,
  }),
});

/** Assemble the exact request that leaves the process for one surface. */
export function buildAdvisoryPrompt(
  surface: AdvisorySurfaceId,
  facts: readonly z.infer<typeof RedactedFieldSchema>[],
): AdvisoryPrompt {
  const template = ADVISORY_TEMPLATES[surface];
  return AdvisoryPromptSchema.parse({
    surface,
    templateVersion: template.version,
    instruction: template.instruction,
    answerSchema: z.toJSONSchema(template.answerSchema, { io: "output", unrepresentable: "any", cycles: "ref" }),
    answerSchemaFingerprint: template.answerSchemaFingerprint,
    facts,
  });
}

/** The whole failure-triage question, from the stored record. */
export function buildFailureTriagePrompt(failureInput: unknown): AdvisoryPrompt {
  const failure = FailureRecordSchema.parse(failureInput);
  return buildAdvisoryPrompt("failure-triage", buildAdvisoryFacts("failure-triage", failure));
}

/* ── 5. what the adapter produces and what a consumer parses ──────────────── */

/**
 * The adapter's produced value. `answer` is deliberately the open JSON the
 * model returned: the adapter owns transport and provenance, and the CONSUMER
 * owns the closed schema — one adapter cannot hold every surface's result type
 * without becoming a second place surfaces are enumerated.
 */
export const AdvisoryAnswerEnvelopeSchema = z.strictObject({
  surface: AdvisorySurfaceIdSchema,
  provider: AiProviderIdSchema,
  model: AiModelIdSchema,
  answerSchemaFingerprint: FingerprintSchema,
  answer: JsonValueSchema,
});
export type AdvisoryAnswerEnvelope = z.infer<typeof AdvisoryAnswerEnvelopeSchema>;

export const ADVISORY_ANSWER_SCHEMA_HASH = deriveSchemaHash(AdvisoryAnswerEnvelopeSchema, "output");

/* ── 6. the recorded invocation and the three outcomes ────────────────────── */

export const AdvisoryInvocationSchema = z.strictObject({
  surface: AdvisorySurfaceIdSchema,
  promptTemplateVersion: z.number().int().positive(),
  redactedInputDigest: FingerprintSchema,
  resultSchemaFingerprint: FingerprintSchema,
  startedAt: IsoInstantSchema,
  endedAt: IsoInstantSchema,
  /** Absent when the call never reached a provider (denied, no adapter). */
  provider: AiProviderIdSchema.optional(),
  model: AiModelIdSchema.optional(),
});
export type AdvisoryInvocation = z.infer<typeof AdvisoryInvocationSchema>;

export const AdvisoryUnavailableCodeSchema = z.enum([
  "concurrency-exhausted",
  "rate-exhausted",
  "daily-request-exhausted",
  "daily-cost-exhausted",
  "aborted",
  "timeout",
  "adapter-unavailable",
]);

/**
 * One outcome, per §4.4's exact vocabulary. There is no fourth arm and no
 * "empty advice" — a provider that answered nothing usable is
 * `invalid-response`, and a provider that could not be reached is
 * `unavailable` carrying the closed code the admission kernel produced.
 */
export function advisoryOutcomeSchema<Advice extends z.ZodType>(advice: Advice) {
  return z.discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("advisory-produced"),
      invocation: AdvisoryInvocationSchema.refine(
        (invocation) => invocation.provider !== undefined && invocation.model !== undefined,
        "a produced advisory must name the provider and model that answered",
      ),
      advice,
    }),
    z.strictObject({
      outcome: z.literal("unavailable"),
      invocation: AdvisoryInvocationSchema,
      code: AdvisoryUnavailableCodeSchema,
      reason: z.string().min(1),
      retryAt: IsoInstantSchema.optional(),
    }),
    z.strictObject({
      outcome: z.literal("invalid-response"),
      invocation: AdvisoryInvocationSchema,
      reason: z.string().min(1),
    }),
  ]);
}

export const FailureTriageOutcomeSchema = advisoryOutcomeSchema(FailureTriageAdviceSchema);
export type FailureTriageOutcome = z.infer<typeof FailureTriageOutcomeSchema>;

/**
 * Parse a produced envelope's answer through the surface's closed schema.
 *
 * Refusals name schema issue paths without copying an unvalidated provider answer.
 */
export function parseAdvisoryAnswer<Advice extends z.ZodType>(
  envelope: AdvisoryAnswerEnvelope,
  advice: Advice,
  expectedFingerprint: z.infer<typeof FingerprintSchema>,
): Readonly<{ ok: true; advice: z.infer<Advice> }> | Readonly<{ ok: false; reason: string }> {
  if (envelope.answerSchemaFingerprint !== expectedFingerprint) {
    return {
      ok: false,
      reason: `the provider answered against result schema ${envelope.answerSchemaFingerprint.slice(0, 12)}`
        + ` but ${envelope.surface} expects ${expectedFingerprint.slice(0, 12)}`,
    };
  }
  const parsed = advice.safeParse(envelope.answer);
  if (parsed.success) return { ok: true, advice: parsed.data };
  const paths = parsed.error.issues
    .map((issue) => (issue.path.length === 0 ? "<root>" : issue.path.join(".")))
    .slice(0, 8);
  return {
    ok: false,
    reason: `the provider answer does not satisfy the ${envelope.surface} advice schema at: ${paths.join(", ")}`,
  };
}
