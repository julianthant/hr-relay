import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { readProfileIdentity } from "../../../models/config/secrets.js";
import type { ProfileIdentity } from "../../../models/profiles/profile-identity.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { PositiveIntSchema } from "../../../rules/identity/ids.js";
import { PROFILE_INITIALS_INPUT_PATH, ProtectedInputBindingsSchema, protectedDeclarationPaths, protectedInputBindings, type ProtectedInputBinding } from "../../../models/write-safety/protected-input.js";
import type { SchemaBoundCanonicalValue } from "../../../models/validation/schema-bound-value.js";
import { projectFailureDisplay } from "../../../models/dashboard/failure-display.js";
import { ErrorCodeSchema } from "../../../rules/identity/ids.js";
import type { ProtectedSecretSource } from "../../../models/config/secrets.js";
import { ProfileInitialsSchema } from "../../../models/profiles/profile.js";


export function hasProtectedSubject(bindings: readonly ProtectedInputBinding[]): boolean {
  return bindings.some(({ inputPath }) => inputPath !== "timekeeperName");
}

export function protectedSubjectDisplay(bindings: readonly ProtectedInputBinding[],
  display: () => Readonly<{ title: string; subtitle?: string }>): Readonly<{ title: string; subtitle?: string }> {
  if (hasProtectedSubject(bindings)) return { title: "Protected test subject" };
  const proposed = display();
  return { title: proposed.title, ...(proposed.subtitle === undefined ? {} : { subtitle: proposed.subtitle }) };
}

const PROTECTED_SUBJECT_DISPLAY_CODE = ErrorCodeSchema.parse("PROTECTED_SUBJECT_DISPLAY_REFUSED");

export class ProtectedSubjectDisplayRefusedError extends Error {
  readonly code = PROTECTED_SUBJECT_DISPLAY_CODE;
  constructor() {
    super(projectFailureDisplay({ code: PROTECTED_SUBJECT_DISPLAY_CODE }).observation);
    this.name = "ProtectedSubjectDisplayRefusedError";
  }
}


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
      for (const inputPath of protectedDeclarationPaths(declaration)) {
        if (submission !== null && typeof submission === "object" && Object.hasOwn(submission, inputPath)) {
          throw new Error(`caller-supplied protected input ${inputPath} is refused`);
        }
      }
    }
  }
  let identity: ProfileIdentity | undefined;
  if (declarations.length > 0) {
    if (source === undefined) throw new Error("protected input timekeeperName profile is unavailable");
    identity = readProfileIdentity(source);
    if (!ProfileInitialsSchema.safeParse(identity.initials).success)
      throw new Error("protected input timekeeperInitials is refused: the profile's stored Timekeeper initials are not 1-8 letters A-Z");
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
      if (identity === undefined) throw new Error("protected input profile identity is absent");
      // One profile identity read supplies the timekeeper's name and stored initials.
      admitted[declaration.inputPath] = identity.displayName;
      admitted[PROFILE_INITIALS_INPUT_PATH] = identity.initials;
      bindings.push({ ...declaration, kind: "profile", profileId: identity.profileId, sessionEpoch: identity.sessionEpoch });
    }
    return { raw, admitted, bindings };
  });
}
