import { z } from "zod";

export const PROFILE_ENROLLMENT_EXTENSION_MODE = "onboarding";

const Base64Schema = z.string().min(4).max(16_384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const CredentialIdSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/u);
const TimestampSchema = z.iso.datetime();
export const DuoKeyIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const DuoKeyNameSchema = z.string().min(1).max(160)
  .regex(/^[^\p{Cc}]+$/u).refine(value => value === value.trim());
const KeyChangeTarget = { commandId: z.uuid(), keyId: DuoKeyIdSchema, expectedRevision: z.number().int().safe().nonnegative() };
export const DuoKeyChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...KeyChangeTarget, kind: z.literal("remove") }),
  z.strictObject({ ...KeyChangeTarget, kind: z.literal("rename"), name: z.string().trim().pipe(DuoKeyNameSchema) }),
]);
export type DuoKeyChange = z.infer<typeof DuoKeyChangeSchema>;
export const DuoKeyChangeReceiptSchema = z.strictObject({ ...KeyChangeTarget, kind: z.enum(["rename", "remove"]),
  requestDigest: DuoKeyIdSchema, at: TimestampSchema });

export const BrowserDocumentIdSchema = z.string().length(32).regex(/^[0-9a-f]{32}$/iu);

export const DuoEnrollmentScopeSchema = z.strictObject({
  armId: z.uuid(), contextId: BrowserDocumentIdSchema, tabId: z.number().int().nonnegative(), accountId: z.uuid(),
  origin: z.url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.origin === value; }),
  rpId: z.string().min(1).max(253).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u),
  armedAt: TimestampSchema, expiresAt: TimestampSchema,
}).refine(value => Date.parse(value.expiresAt) - Date.parse(value.armedAt) === 600_000, { message: "duo-arm-lifetime-invalid" });
export type DuoEnrollmentScope = z.infer<typeof DuoEnrollmentScopeSchema>;

const CredentialFields = {
  credentialId: CredentialIdSchema, scope: DuoEnrollmentScopeSchema,
  privateKeyPkcs8: Base64Schema, publicKeySpki: Base64Schema,
  createdAt: TimestampSchema,
  name: DuoKeyNameSchema.optional(),
  authenticator: z.strictObject({ userHandle: z.string().optional(), transport: z.literal("usb"), isResidentCredential: z.boolean() }).optional(),
};
export const DuoStoredCredentialSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), ...CredentialFields, reenrol: z.literal(true).optional() }),
  z.strictObject({ state: z.literal("staged"), ...CredentialFields, reenrol: z.literal(true), provedAt: TimestampSchema }),
  z.strictObject({ state: z.literal("ready"), ...CredentialFields, confirmedAt: TimestampSchema }),
]);
export type DuoStoredCredential = z.infer<typeof DuoStoredCredentialSchema>;

export const DuoCredentialRecordSchema = z.strictObject({
  credentials: z.array(DuoStoredCredentialSchema).max(1000),
  keyChanges: z.array(DuoKeyChangeReceiptSchema).max(100_000).optional(),
}).superRefine((value, context) => {
  if (new Set(value.credentials.map(row => row.credentialId)).size !== value.credentials.length) context.addIssue({ code: "custom", message: "duo-credential-membership-invalid" });
  if (value.keyChanges !== undefined && new Set(value.keyChanges.map(row => row.commandId)).size !== value.keyChanges.length) {
    context.addIssue({ code: "custom", message: "duo-key-change-membership-invalid" });
  }
  for (const credential of value.credentials) {
    const settledAt = credential.state === "ready" ? credential.confirmedAt : credential.state === "staged" ? credential.provedAt : undefined;
    if (Date.parse(credential.createdAt) < Date.parse(credential.scope.armedAt)
      || Date.parse(credential.createdAt) >= Date.parse(credential.scope.expiresAt)
      || settledAt !== undefined && (Date.parse(settledAt) < Date.parse(credential.createdAt)
        || Date.parse(settledAt) >= Date.parse(credential.scope.expiresAt))) context.addIssue({ code: "custom", message: "duo-credential-event-order-invalid" });
  }
});
export type DuoCredentialRecord = z.infer<typeof DuoCredentialRecordSchema>;

export const DuoReenrolCommitIntentSchema = z.strictObject({
  commitId: z.uuid(), accountId: z.uuid(), duoRevision: z.number().int().safe().positive(),
  stagedIds: z.array(CredentialIdSchema).min(1).max(1000), retireIds: z.array(CredentialIdSchema).max(1000),
  mac: z.string().regex(/^[a-f0-9]{64}$/u),
}).superRefine((value, context) => {
  const ids = [...value.stagedIds, ...value.retireIds];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duo-reenrol-intent-membership-invalid" });
});
export type DuoReenrolCommitIntent = z.infer<typeof DuoReenrolCommitIntentSchema>;
