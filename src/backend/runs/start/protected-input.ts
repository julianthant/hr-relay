import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { ProtectedStoreRecordSchema, type ProtectedStoreRecord } from "../../../models/config/protected-settings.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { PositiveIntSchema } from "../../../rules/identity/ids.js";
import { ProtectedInputBindingsSchema, protectedInputBindings, type ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";


export function protectedSubjectMatchKey(bindings: readonly ProtectedInputBinding[], canonicalInput: unknown): string {
  const base = `protected-input:${canonicalJsonStringify(bindings)}`;
  if (!bindings.some(({ inputPath }) => inputPath === "documentNumber")) return base;
  if (canonicalInput === null || typeof canonicalInput !== "object" || Array.isArray(canonicalInput))
    throw new Error("protected document input must be a canonical object");
  const reRead: unknown = Reflect.get(canonicalInput, "reRead");
  if (reRead === undefined) return base;
  if (reRead === null || typeof reRead !== "object" || Array.isArray(reRead))
    throw new Error("protected document reread must be a canonical object");
  const ordinal = PositiveIntSchema.safeParse(Reflect.get(reRead, "ordinal"));
  if (!ordinal.success) throw new Error("protected document reread ordinal is invalid");
  return `${base}#re-read-${String(ordinal.data)}`;
}

/** Server-only admission before ingress parsing or identity creation. No caller override is compared. */
export function admitProtectedInput(
  descriptor: AnyWorkflowDescriptor,
  submissions: readonly unknown[],
  source?: ProtectedSecretSource,
  retained?: readonly SchemaBoundCanonicalValue[],
  sourceBindings?: readonly ProtectedInputBinding[],
): readonly Readonly<{ raw: JsonValue; admitted: JsonValue; bindings: readonly ProtectedInputBinding[] }>[] {
  const declarations = descriptor.protectedInputs ?? [];
  for (const submission of submissions) {
    for (const declaration of declarations) {
      if (submission !== null && typeof submission === "object" && Object.hasOwn(submission, declaration.inputPath)) {
        throw new Error(`caller-supplied protected input ${declaration.name} is refused`);
      }
    }
  }
  let record: ProtectedStoreRecord | undefined;
  if (declarations.length > 0 && retained === undefined) {
    if (source === undefined) throw new Error("protected input timekeeperName source is unavailable");
    try { record = ProtectedStoreRecordSchema.parse(source.read()); }
    catch { throw new Error("protected input timekeeperName source is unreadable"); }
    for (const declaration of declarations) {
      if (record.entries[declaration.name] === undefined) throw new Error(`protected input ${declaration.name} is absent`);
    }
  }
  if (retained !== undefined && retained.length !== submissions.length) throw new Error("retained input count mismatch");
  return submissions.map((submission, index) => {
    const parsedRaw = JsonValueSchema.safeParse(submission);
    if (!parsedRaw.success) {
      throw new Error(`start plan ${descriptor.id} entry ${String(index + 1)} is not strict JSON and cannot be retained`);
    }
    const raw = parsedRaw.data;
    const priorBindings = retained?.[index]?.protectedBindings;
    const inputBindings = ProtectedInputBindingsSchema.parse(priorBindings ?? sourceBindings ?? []);
    for (const binding of inputBindings) {
      if (binding.inputPath === "timekeeperName") continue;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !Object.hasOwn(raw, binding.inputPath))
        throw new Error(`protected input ${binding.name} is absent`);
      const priorValue = retained?.[index]?.value;
      if (priorValue !== undefined && (priorValue === null || typeof priorValue !== "object" || Array.isArray(priorValue)
        || Reflect.get(raw, binding.inputPath) !== Reflect.get(priorValue, binding.inputPath)))
        throw new Error(`retained protected input ${binding.name} cannot change`);
    }
    if (declarations.length === 0) return { raw, admitted: raw,
      bindings: inputBindings.length > 0 ? inputBindings : protectedInputBindings(raw) };
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("protected workflow input requires an object");
    const admitted: Record<string, JsonValue> = Object.fromEntries(Object.entries(raw));
    const bindings: ProtectedInputBinding[] = inputBindings.filter(({ inputPath }) =>
      !declarations.some((declaration) => declaration.inputPath === inputPath));
    for (const declaration of declarations) {
      if (retained !== undefined) {
        const prior = retained[index];
        const value = prior?.value;
        if (value === null || typeof value !== "object" || Array.isArray(value)
          || !Object.hasOwn(value, declaration.inputPath)) throw new Error(`retained protected input ${declaration.name} is absent`);
        admitted[declaration.inputPath] = JsonValueSchema.parse(Reflect.get(value, declaration.inputPath));
        const binding = protectedInputBindings(value, prior?.protectedBindings).find(({ name }) => name === declaration.name);
        if (binding === undefined) throw new Error(`retained protected input ${declaration.name} binding is absent`);
        bindings.push(binding);
      } else {
        const entry = record?.entries[declaration.name];
        if (entry === undefined) throw new Error(`protected input ${declaration.name} is absent`);
        admitted[declaration.inputPath] = entry.value;
        bindings.push({ ...declaration, kind: "protected-store", valueId: entry.valueId });
      }
    }
    return { raw, admitted, bindings };
  });
}

/** Only for durable internal relaunch input; public admission still refuses supplied protected paths. */
export function retainedRawSubmission(descriptor: AnyWorkflowDescriptor, value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const paths = new Set((descriptor.protectedInputs ?? []).map(({ inputPath }) => inputPath));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !paths.has(key as "timekeeperName")));
}
