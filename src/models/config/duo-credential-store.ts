import { z } from "zod";

const Base64Schema = z.string().min(4).max(16_384).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const CredentialIdSchema = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/u);
const TimestampSchema = z.iso.datetime();

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
  authenticator: z.strictObject({ userHandle: z.string().optional(), transport: z.enum(["internal", "usb"]), isResidentCredential: z.boolean() }).optional(),
};
export const DuoStoredCredentialSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), ...CredentialFields }),
  z.strictObject({ state: z.literal("ready"), ...CredentialFields, confirmedAt: TimestampSchema }),
]);
export type DuoStoredCredential = z.infer<typeof DuoStoredCredentialSchema>;

export const DuoCredentialRecordSchema = z.strictObject({
  credentials: z.array(DuoStoredCredentialSchema).max(1000),
}).superRefine((value, context) => {
  if (new Set(value.credentials.map(row => row.credentialId)).size !== value.credentials.length) context.addIssue({ code: "custom", message: "duo-credential-membership-invalid" });
  for (const credential of value.credentials) {
    if (Date.parse(credential.createdAt) < Date.parse(credential.scope.armedAt)
      || Date.parse(credential.createdAt) >= Date.parse(credential.scope.expiresAt)
      || credential.state === "ready" && (Date.parse(credential.confirmedAt) < Date.parse(credential.createdAt)
        || Date.parse(credential.confirmedAt) >= Date.parse(credential.scope.expiresAt))) context.addIssue({ code: "custom", message: "duo-credential-event-order-invalid" });
  }
});
export type DuoCredentialRecord = z.infer<typeof DuoCredentialRecordSchema>;
