import { z } from "zod";
import { NonNegativeIntSchema } from "../../../rules/identity/ids.js";
import { ProcessStartIdentitySchema } from "../sqlite/runtime-process-locks.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const MutexOwnerSchema = z.strictObject({ schemaVersion: z.literal(1), acquisitionId: z.uuid(),
  phase: z.literal("admitting"), pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema });
export const FlatBackupRecoveryBindingSchema = z.strictObject({ kind: z.enum(["source-record", "empty-allocation"]),
  allocationDevice: z.number().int().nonnegative(), allocationInode: z.number().int().nonnegative(), sourceDigest: DigestSchema });

const OwnerMutexRecoveryReceiptSchema = z.strictObject({ schemaVersion: z.literal(1), acquisitionId: z.uuid(),
  pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema,
  installationId: z.uuid(), generation: NonNegativeIntSchema, ownerFile: z.string().min(1),
  ownerSha256: z.string().regex(/^[0-9a-f]{64}$/u), recoveredAt: z.iso.datetime(), flatBackup: FlatBackupRecoveryBindingSchema.optional() });

const EmptyMutexRecoveryReceiptSchema = z.strictObject({ schemaVersion: z.literal(1), custody: z.literal("empty"),
  acquisitionId: z.uuid(), installationId: z.uuid(), generation: NonNegativeIntSchema,
  directoryDevice: NonNegativeIntSchema, directoryInode: NonNegativeIntSchema, recoveredAt: z.iso.datetime(), flatBackup: FlatBackupRecoveryBindingSchema.optional() });
export const MutexRecoveryReceiptSchema = z.union([OwnerMutexRecoveryReceiptSchema, EmptyMutexRecoveryReceiptSchema]);
