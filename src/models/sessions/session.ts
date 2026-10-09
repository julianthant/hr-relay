import { z } from "zod";
import { BrowserSystemIdSchema } from "../../rules/identity/ids.js";

export const SessionNeedSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  access: z.enum(["read", "transaction"]),
  session: z.enum(["reuse-worker", "fresh"]),
  exclusive: z.literal(true).optional(),
  acceptDownloads: z.literal(true).optional(),
});

export const LoginResultSchema = z.enum(["logged-in", "already-authenticated"]);

export const IdleRefreshCadenceSchema = z.strictObject({
  intervalMs: z.number().int().positive(),
});

export const RetryPolicySchema = z.strictObject({
  attempts: z.union([z.literal(2), z.literal(3)]),
  backoffMs: z.number().int().nonnegative(),
  retryOn: z.literal("transient"),
});

export type SessionNeed<S extends z.infer<typeof BrowserSystemIdSchema> = z.infer<typeof BrowserSystemIdSchema>> =
  Omit<z.infer<typeof SessionNeedSchema>, "system"> & Readonly<{ system: S }>;
export type LoginResult = z.infer<typeof LoginResultSchema>;
export type IdleRefreshCadence = z.infer<typeof IdleRefreshCadenceSchema>;
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
