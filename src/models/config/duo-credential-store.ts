import { z } from "zod";

const RevisionSchema = z.number().int().safe().positive();
const CountSchema = z.number().int().min(0).max(0xffff_ffff);
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
  createdAt: TimestampSchema, highWater: CountSchema,
  authenticator: z.strictObject({ userHandle: z.string().optional(), transport: z.enum(["internal", "usb"]), isResidentCredential: z.boolean() }).optional(),
};
export const DuoStoredCredentialSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), ...CredentialFields }),
  z.strictObject({ state: z.literal("ready"), ...CredentialFields, confirmedAt: TimestampSchema }),
]);
export type DuoStoredCredential = z.infer<typeof DuoStoredCredentialSchema>;

export const DuoSignReservationSchema = z.strictObject({
  attemptId: z.uuid(), credentialId: CredentialIdSchema, count: CountSchema,
  reservedAt: TimestampSchema,
});
export type DuoSignReservation = z.infer<typeof DuoSignReservationSchema>;

export const DuoCredentialDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), installationId: z.uuid(), profileId: z.uuid(), revision: RevisionSchema,
  credentials: z.array(DuoStoredCredentialSchema).max(1000),
  retired: z.array(z.strictObject({ credentialId: CredentialIdSchema, highWater: CountSchema })).max(100_000),
  reservations: z.array(DuoSignReservationSchema).max(100_000),
}).superRefine((value, context) => {
  const ids = [...value.credentials, ...value.retired].map(row => row.credentialId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "duo-credential-membership-invalid" });
  if (new Set(value.reservations.map(row => row.attemptId)).size !== value.reservations.length) context.addIssue({ code: "custom", message: "duo-attempt-reused" });
  const counts = new Set<string>();
  const previous = new Map<string, number>();
  for (const reservation of value.reservations) {
    const owner = [...value.credentials, ...value.retired].find(row => row.credentialId === reservation.credentialId);
    const key = `${reservation.credentialId}:${String(reservation.count)}`;
    if (owner === undefined || reservation.count === 0 || reservation.count > owner.highWater || counts.has(key)
      || reservation.count <= (previous.get(reservation.credentialId) ?? 0)) context.addIssue({ code: "custom", message: "duo-reservation-lineage-invalid" });
    counts.add(key); previous.set(reservation.credentialId, reservation.count);
  }
  for (const owner of [...value.credentials, ...value.retired]) {
    if (owner.highWater !== (previous.get(owner.credentialId) ?? 0)) context.addIssue({ code: "custom", message: "duo-reservation-head-mismatch" });
  }
  for (const credential of value.credentials) {
    if (Date.parse(credential.createdAt) < Date.parse(credential.scope.armedAt)
      || Date.parse(credential.createdAt) >= Date.parse(credential.scope.expiresAt)
      || credential.state === "pending" && credential.highWater !== 0
      || credential.state === "ready" && (Date.parse(credential.confirmedAt) < Date.parse(credential.createdAt)
        || Date.parse(credential.confirmedAt) >= Date.parse(credential.scope.expiresAt))) context.addIssue({ code: "custom", message: "duo-credential-event-order-invalid" });
  }
});
export type DuoCredentialDocument = z.infer<typeof DuoCredentialDocumentSchema>;

const PhysicalWitnessSchema = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: z.string().regex(/^[0-9a-f]{64}$/u) });
export const DuoContinuityRowSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("never-initialized"), profileId: z.uuid(), revision: z.literal(0) }),
  z.strictObject({ state: z.literal("registered"), profileId: z.uuid(), revision: RevisionSchema, document: PhysicalWitnessSchema }),
  z.strictObject({ state: z.literal("erased"), profileId: z.uuid(), revision: RevisionSchema, document: PhysicalWitnessSchema }),
]);
export type DuoContinuityRow = z.infer<typeof DuoContinuityRowSchema>;
export const DuoDocumentEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1), purpose: z.literal("relay:duo-credential:v1"), algorithm: z.literal("aes-256-gcm"),
  installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(), revision: RevisionSchema,
  nonce: z.string().length(16).regex(/^[A-Za-z0-9+/]{16}$/u),
  tag: z.string().length(24).regex(/^[A-Za-z0-9+/]{22}==$/u), ciphertext: z.string().min(4).max(Math.ceil(16 * 1024 * 1024 / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});
