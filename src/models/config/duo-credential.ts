import { z } from "zod";

export const DuoCredentialSchema = z.strictObject({
  rpId: z.literal("duosecurity.com"), credentialId: z.string().min(1), privateKey: z.string().min(1),
  signCount: z.number().int().nonnegative().max(4294967295), transport: z.enum(["internal", "usb"]),
  userHandle: z.string().nullable().optional(), isResidentCredential: z.boolean().optional(),
  deviceName: z.string().optional(), enrolledAt: z.string().optional(),
});
export const DuoCredentialFileSchema = z.union([DuoCredentialSchema, z.array(DuoCredentialSchema).min(1), z.strictObject({ credentials: z.array(DuoCredentialSchema).min(1) })]);
