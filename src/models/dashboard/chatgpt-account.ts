import { z } from "zod";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema } from "../failures/error-catalog.js";

export const ChatGptAccountCodeSchema = ErrorCatalogCodeSchema.refine(code => code.startsWith("CHATGPT_"));
const FailureSchema = z.strictObject({ code: ChatGptAccountCodeSchema, message: z.string() })
  .refine(value => value.message === ERROR_CATALOG[value.code].text);
const fixedFailure = (value: { readonly code?: keyof typeof ERROR_CATALOG; readonly message?: string }) =>
  value.code === undefined || value.message === ERROR_CATALOG[value.code].text;
export const ChatGptAccountStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("signed-out") }),
  z.strictObject({ state: z.literal("expired") }),
  z.strictObject({ state: z.literal("unavailable"), ...FailureSchema.shape }).refine(fixedFailure),
  z.strictObject({ state: z.literal("connected"), name: z.string().min(1).max(256), email: z.email(), expiresAt: IsoInstantSchema,
    planUsage: z.enum(["enabled", "disabled", "limit-reached"]) }),
]);
export type ChatGptAccountState = z.infer<typeof ChatGptAccountStateSchema>;
export const ChatGptAttemptIdSchema = z.uuid();
export const ChatGptSignInRequestSchema = z.strictObject({ usePlan: z.boolean() });
export const ChatGptEmptyRequestSchema = z.strictObject({});
export const ChatGptConnectionCheckRequestSchema = z.strictObject({ fresh: z.literal(true).optional() });
export const ChatGptAuthorizationUrlSchema = z.url().refine(value => {
  const url = new URL(value);
  return url.origin === "https://auth.openai.com" && url.pathname === "/api/accounts/authorize"
    && url.username === "" && url.password === "" && url.hash === "";
});
export const ChatGptSignInStartSchema = z.strictObject({ state: z.literal("started"), attemptId: ChatGptAttemptIdSchema,
  authorizationUrl: ChatGptAuthorizationUrlSchema, expiresAt: IsoInstantSchema });
export const ChatGptAccountViewSchema = z.union([ChatGptAccountStateSchema,
  z.strictObject({ state: z.literal("signing-in"), attemptId: ChatGptAttemptIdSchema, expiresAt: IsoInstantSchema, authorizationUrl: ChatGptAuthorizationUrlSchema, account: ChatGptAccountStateSchema }),
]);
const RefusedSchema = z.strictObject({ state: z.literal("refused"), ...FailureSchema.shape }).refine(fixedFailure);
const UncertainSchema = z.strictObject({ state: z.literal("uncertain"), ...FailureSchema.shape }).refine(fixedFailure);
export const ChatGptSignInStartResultSchema = z.union([ChatGptSignInStartSchema, RefusedSchema, UncertainSchema]);
export const ChatGptSignInCompletionSchema = z.union([
  z.strictObject({ state: z.literal("completed"), attemptId: ChatGptAttemptIdSchema, account: ChatGptAccountStateSchema }),
  z.strictObject({ state: z.literal("refused"), attemptId: ChatGptAttemptIdSchema, ...FailureSchema.shape }).refine(fixedFailure),
  z.strictObject({ state: z.literal("uncertain"), attemptId: ChatGptAttemptIdSchema, ...FailureSchema.shape }).refine(fixedFailure),
]);
export const ChatGptCancelResultSchema = z.union([
  z.strictObject({ state: z.literal("cancelled"), attemptId: ChatGptAttemptIdSchema }), RefusedSchema, UncertainSchema,
]);
export const ChatGptSignedOutSchema = z.strictObject({ state: z.literal("signed-out"), remoteRevocation: z.enum(["confirmed", "unconfirmed", "not-needed"]) });
export const ChatGptSignOutResultSchema = z.union([ChatGptSignedOutSchema, RefusedSchema, UncertainSchema]);
export type ChatGptSignedOut = z.infer<typeof ChatGptSignedOutSchema>;
export type ChatGptSignInRequest = z.infer<typeof ChatGptSignInRequestSchema>;
export type ChatGptSignInStart = z.infer<typeof ChatGptSignInStartSchema>;
export type ChatGptAccountView = z.infer<typeof ChatGptAccountViewSchema>;
export type ChatGptSignInCompletion = z.infer<typeof ChatGptSignInCompletionSchema>;

export const ChatGptCheckedConnectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("completed"), checkedAt: IsoInstantSchema, failureCode: z.null() }),
  z.strictObject({ state: z.literal("refused"), checkedAt: IsoInstantSchema, failureCode: ChatGptAccountCodeSchema }),
  z.strictObject({ state: z.literal("uncertain"), checkedAt: IsoInstantSchema, failureCode: ChatGptAccountCodeSchema }),
]);
/** `unchecked`: nothing has asked the provider about the account as it is stored now. */
export const ChatGptConnectionStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("unchecked"), checkedAt: z.null(), failureCode: z.null() }),
  ...ChatGptCheckedConnectionSchema.options,
]);
export const ChatGptUsageStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("available"), resetAt: z.null() }),
  z.strictObject({ state: z.literal("limit-reached"), resetAt: z.null() }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.enum(["signed-out", "expired", "pending", "closed", "unavailable", "disabled"]) }),
]);
export const ChatGptAccountStatusSchema = z.strictObject({
  account: ChatGptAccountViewSchema, connection: ChatGptConnectionStatusSchema, usage: ChatGptUsageStatusSchema,
  /** Model evidence from a check that asked for OCR readiness. */
  ocrModelAvailable: z.boolean().optional(),
});
export type ChatGptAccountStatus = z.infer<typeof ChatGptAccountStatusSchema>;
export const chatGptOcrAvailable = ({ usage, connection }: ChatGptAccountStatus): boolean =>
  usage.state === "available" && connection.state === "completed";

export function chatGptConnectionCurrent(connection: ChatGptAccountStatus["connection"], nowMs: number): boolean {
  if (connection.state !== "completed") return false;
  const age = nowMs - Date.parse(connection.checkedAt);
  return age >= 0 && age <= 300_000;
}

export const ChatGptOcrTestResultSchema = z.union([
  z.strictObject({ state: z.literal("completed"), model: z.string().min(1).max(128) }), RefusedSchema, UncertainSchema,
]);
