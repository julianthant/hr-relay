import { z } from "zod";

const TokenCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const TokenTotalsSchema = z.strictObject({ inputTokens: TokenCountSchema, outputTokens: TokenCountSchema, totalTokens: TokenCountSchema });
const validTokenTotal = (value: z.infer<typeof TokenTotalsSchema>) => value.inputTokens <= Number.MAX_SAFE_INTEGER - value.outputTokens
  && value.totalTokens === value.inputTokens + value.outputTokens;
export const AssistantCallUsageSchema = z.discriminatedUnion("state", [
  TokenTotalsSchema.extend({ state: z.literal("measured") }).refine(validTokenTotal),
  z.strictObject({ state: z.literal("unavailable"), reason: z.enum(["missing", "invalid"]) }),
]);
export type AssistantCallUsage = z.infer<typeof AssistantCallUsageSchema>;
export const AssistantTurnUsageSchema = z.discriminatedUnion("state", [
  TokenTotalsSchema.extend({ state: z.literal("measured"), callCount: TokenCountSchema }).refine(value => validTokenTotal(value) && (value.callCount !== 0 || value.totalTokens === 0)),
  z.strictObject({ state: z.literal("unavailable"), reason: z.enum(["missing", "invalid"]), callCount: TokenCountSchema.min(1), measuredCallCount: TokenCountSchema,
    partialInputTokens: TokenCountSchema, partialOutputTokens: TokenCountSchema, partialTotalTokens: TokenCountSchema,
  }).refine(value => value.measuredCallCount < value.callCount
    && (value.measuredCallCount !== 0 || value.partialTotalTokens === 0)
    && validTokenTotal({ inputTokens: value.partialInputTokens, outputTokens: value.partialOutputTokens, totalTokens: value.partialTotalTokens })),
]);
export type AssistantTurnUsage = z.infer<typeof AssistantTurnUsageSchema>;
/** One slot per attempted inference. Partial totals/count include only complete measurements whose safe sums fit. */
export function aggregateAssistantUsage(calls: readonly (AssistantCallUsage | undefined)[]): AssistantTurnUsage {
  let inputTokens = 0, outputTokens = 0, totalTokens = 0, measuredCallCount = 0;
  let reason: "missing" | "invalid" | undefined = undefined;
  for (const call of calls) {
    if (call?.state !== "measured") {
      if (reason !== "invalid") reason = call?.reason ?? "missing";
      continue;
    }
    if (inputTokens > Number.MAX_SAFE_INTEGER - call.inputTokens || outputTokens > Number.MAX_SAFE_INTEGER - call.outputTokens
      || totalTokens > Number.MAX_SAFE_INTEGER - call.totalTokens) {
      reason = "invalid";
      continue;
    }
    inputTokens += call.inputTokens; outputTokens += call.outputTokens; totalTokens += call.totalTokens; measuredCallCount++;
  }
  return AssistantTurnUsageSchema.parse(reason === undefined
    ? { state: "measured", callCount: calls.length, inputTokens, outputTokens, totalTokens }
    : { state: "unavailable", callCount: calls.length, measuredCallCount, reason,
      partialInputTokens: inputTokens, partialOutputTokens: outputTokens, partialTotalTokens: totalTokens });
}
