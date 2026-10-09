import { FingerprintSchema } from "../../rules/identity/ids.js";
import { z } from "zod";
import { JsonValueSchema, type JsonValue } from "../../rules/validation/canonical-json.js";

/** The first admitted protected workflow input; data only, safe in descriptor bundles. */
export const ProtectedInputDeclarationSchema = z.strictObject({
  inputPath: z.literal("timekeeperName"),
  name: z.literal("timekeeperName"),
});
const ProtectedInputPathSchema = z.enum(["timekeeperName", "documentNumber", "emplId"]);
const ProtectedInputNameSchema = z.enum(["timekeeperName", "separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]);
/** Where a protected input's VALUE came from; no member ever carries a value or a value-derived surrogate. */
export const ProtectedInputBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("protected-store"), inputPath: z.literal("timekeeperName"),
    name: z.literal("timekeeperName"), valueId: z.uuid() }),
  z.strictObject({ kind: z.literal("test-data-local"), inputPath: z.enum(["documentNumber", "emplId"]),
    name: z.enum(["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]), sourceId: z.uuid() }),
  z.strictObject({ kind: z.literal("legacy-protected-input"), inputPath: ProtectedInputPathSchema,
    name: ProtectedInputNameSchema }),
]).superRefine((binding, ctx) => {
  const expected = { timekeeperName: "timekeeperName", documentNumber: "separationsKualiFinalizationCanaryDocumentNumber",
    emplId: "personLookupCanaryEid" };
  if (expected[binding.inputPath] !== binding.name) ctx.addIssue({ code: "custom", message: "protected input path/name mismatch" });
});
export const ProtectedInputBindingsSchema = z.array(ProtectedInputBindingSchema).max(3).superRefine((bindings, ctx) => {
  if (new Set(bindings.map(({ inputPath }) => inputPath)).size !== bindings.length)
    ctx.addIssue({ code: "custom", message: "duplicate protected input binding" });
});
export type ProtectedInputDeclaration = z.infer<typeof ProtectedInputDeclarationSchema>;
export type ProtectedInputBinding = z.infer<typeof ProtectedInputBindingSchema>;

/** Historical inputs remain readable, but their value is never a new fingerprint preimage. */
export function protectedInputBindings(value: unknown, bindings?: readonly ProtectedInputBinding[]): readonly ProtectedInputBinding[] {
  if (bindings !== undefined) {
    const parsed = ProtectedInputBindingsSchema.parse(bindings);
    if (parsed.length === 0 && value !== null && typeof value === "object" && Object.hasOwn(value, "timekeeperName")) {
      throw new Error("protected input timekeeperName binding is absent");
    }
    return parsed;
  }
  return value !== null && typeof value === "object" && Object.hasOwn(value, "timekeeperName")
    ? [{ kind: "legacy-protected-input", name: "timekeeperName", inputPath: "timekeeperName" }]
    : [];
}

export function valueFreeProtectedInput(value: unknown, bindings?: readonly ProtectedInputBinding[]): JsonValue {
  const parsed = JsonValueSchema.parse(value);
  const identities = protectedInputBindings(parsed, bindings);
  if (identities.length === 0) return parsed;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("protected input binding requires an object");
  }
  const copy = new Map<string, JsonValue>(Object.entries(parsed));
  for (const binding of identities) {
    if (!Object.hasOwn(parsed, binding.inputPath)) throw new Error(`protected input ${binding.name} is absent`);
    copy.set(binding.inputPath, binding);
  }
  return JsonValueSchema.parse(Object.fromEntries(copy));
}

/** Closed protected fields that can occur in the admitted Separations input/output graph. */
const PROTECTED_COMMENT_FIELDS = new Set(["timekeeperComments", "dateChangeComments", "observedExistingComments"]);

/** Fingerprint projection only: private execution values stay in their canonical records. */
export function valueFreeProtectedData(value: unknown, bindings?: readonly ProtectedInputBinding[]): JsonValue {
  const parsed = JsonValueSchema.parse(value);
  const sensitive = new Map<string, string>();
  const collect = (entry: JsonValue, inherited: readonly ProtectedInputBinding[]): void => {
    if (entry === null || typeof entry !== "object") return;
    if (Array.isArray(entry)) { for (const child of entry) collect(JsonValueSchema.parse(child), inherited); return; }
    const metadata: unknown = Reflect.get(entry, "protectedBindings");
    const active = metadata === undefined ? inherited : ProtectedInputBindingsSchema.parse(metadata);
    for (const [key, child] of Object.entries(entry)) {
      const binding = active.find(({ inputPath }) => inputPath === key);
      if (typeof child === "string" && (binding !== undefined || key === "timekeeperName"))
        sensitive.set(child, `<protected ${binding?.name ?? "timekeeperName"}>`);
      collect(child, active);
    }
  };
  collect(parsed, bindings ?? []);
  const project = (entry: JsonValue, inherited: readonly ProtectedInputBinding[]): JsonValue => {
    if (entry === null || typeof entry !== "object") return entry;
    if (Array.isArray(entry)) return entry.map((child) => project(JsonValueSchema.parse(child), inherited));
    const metadata: unknown = Reflect.get(entry, "protectedBindings");
    const ownBindings = metadata === undefined ? inherited : ProtectedInputBindingsSchema.parse(metadata);
    return Object.fromEntries(Object.entries(entry).map(([key, child]) => {
      if (key === "timekeeper" && child !== null && typeof child === "object" && !Array.isArray(child)) {
        const safe = Object.fromEntries(Object.entries(child).map(([field, value]) => [field,
          field === "name" ? { kind: "legacy-protected-input", name: "timekeeperName", inputPath: "timekeeperName" }
            : field === "comments" ? { state: "withheld-protected-input" } : project(value, ownBindings)]));
        return [key, safe];
      }
      if (ownBindings.some(({ inputPath }) => inputPath !== "timekeeperName")
        && ["idempotencyKey", "idempotencyKeyDigest", "businessKeyDigest", "occurrenceKeyDigest"].includes(key)) {
        return [key, "withheld-protected-input"];
      }
      if (PROTECTED_COMMENT_FIELDS.has(key) && typeof child === "string") {
        // Both admitted comment builders sign a line as `. -<initials>` with an optional date.
        // Retain the transaction prose so changes unrelated to the protected signer still bind.
        let text = child;
        for (const [value, marker] of sensitive) if (value.length > 0) text = text.replaceAll(value, marker);
        return [key, text.replace(/(\. -)\S+(?= \d{2}\/\d{2}\/\d{4}(?:\n|$)|\n|$)/gu, "$1<protected timekeeperName>")];
      }
      if (key === "timekeeperName" || ownBindings.some(({ inputPath }) => inputPath === key)) {
        const existing = ProtectedInputBindingSchema.safeParse(child);
        return [key, existing.success ? existing.data : ownBindings.find(({ inputPath }) => inputPath === key)
          ?? { kind: "legacy-protected-input", name: "timekeeperName", inputPath: "timekeeperName" }];
      }
      return [key, project(child, ownBindings)];
    }));
  };
  return project(parsed, bindings ?? []);
}

/** Presentation only. The natural permanent key and its authoritative digest never change. */
export const PublicTransactionKeyDigestSchema = z.union([FingerprintSchema, z.literal("withheld-protected-input")]);
export function publicTransactionKeyDigest(digest: string, withheld: boolean): string {
  return withheld ? "withheld-protected-input" : FingerprintSchema.parse(digest);
}
export function hasProtectedTransactionInput(run: Readonly<{
  envelope: Readonly<{ workflow: string }>;
  input: Readonly<{ parsed: Readonly<{ protectedBindings?: readonly ProtectedInputBinding[] }> }>;
}>): boolean {
  const bindings = run.input.parsed.protectedBindings;
  if (bindings !== undefined) return bindings.some(({ inputPath }) => inputPath !== "timekeeperName");
  // Historical rows did not retain source identity: never assert that their identifier is public.
  return ["separations", "separations-kuali-finalization", "person-lookup"].includes(run.envelope.workflow);
}

/** Remove protected-source evidence leaves after their declared classification was checked. */
export function valueFreeProtectedEvidence(value: unknown, protectedPaths: readonly string[]): JsonValue {
  const walk = (node: JsonValue): JsonValue => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((entry) => walk(JsonValueSchema.parse(entry)));
    const name: unknown = Reflect.get(node, "key");
    if (typeof name === "string" && typeof Reflect.get(node, "classification") === "string" && typeof Reflect.get(node, "transform") === "string") {
      if (name.includes("timekeeper") || name.endsWith("dateChangeComments") || name.endsWith("observedExistingComments")
        || (protectedPaths.some((path) => name === path || name.endsWith(`.${path}`))
          || (protectedPaths.includes("emplId") && /(?:observedEid|eid)$/u.test(name))
          || (protectedPaths.length > 0 && /(?:idempotencyKeyDigest|businessKeyDigest|occurrenceKeyDigest)$/u.test(name))))
        return { key: name, state: "redacted", classification: "direct-identifier", transform: "drop" };
    }
    return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, walk(entry)]));
  };
  return walk(JsonValueSchema.parse(value));
}

export function retainedRunProtectedBindings(run: Readonly<{
  envelope: Readonly<{ workflow: string }>;
  input: Readonly<{ parsed: Readonly<{ value: unknown; protectedBindings?: readonly ProtectedInputBinding[] }> }>;
}>): readonly ProtectedInputBinding[] {
  const parsed = run.input.parsed;
  if (parsed.protectedBindings !== undefined) return protectedInputBindings(parsed.value, parsed.protectedBindings);
  const bindings = [...protectedInputBindings(parsed.value)];
  if (["separations", "separations-kuali-finalization"].includes(run.envelope.workflow))
    bindings.push({ kind: "legacy-protected-input", name: "separationsKualiFinalizationCanaryDocumentNumber", inputPath: "documentNumber" });
  if (run.envelope.workflow === "person-lookup")
    bindings.push({ kind: "legacy-protected-input", name: "personLookupCanaryEid", inputPath: "emplId" });
  return bindings;
}
