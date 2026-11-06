import { z } from "zod";
import type { AssistantFailureCode } from "../../../models/dashboard/assistant.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { AssistantReferenceKind, AssistantReferenceTable } from "../references.js";

/** Where an output leaf's value comes from; only these origins may reach the model. */
export type AssistantToolLeafOrigin = "repository-authored" | "declared-redacted";
export interface AssistantToolContext {
  readonly signal: AbortSignal;
  readonly references: AssistantReferenceTable;
  readonly actorId: string;
  assertCurrent(): void;
}
export interface AssistantTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly output: z.ZodType;
  /** Every output leaf path with its origin; the redaction audit registers it as this tool's process-egress surface. */
  readonly privacy: readonly Readonly<{ path: string; origin: AssistantToolLeafOrigin }>[];
  invoke(argumentsValue: unknown, context: AssistantToolContext): Promise<JsonValue>;
}
export interface AssistantPlugin {
  readonly domain: string;
  readonly tools: readonly AssistantTool[];
}
/** A tool refusal the model can recover from; unrecovered, it becomes the turn's typed refusal. */
export class AssistantToolRefusal extends Error {
  constructor(readonly code: AssistantFailureCode) { super(code); this.name = "AssistantToolRefusal"; }
}

/** A reference token of one kind; pattern-constrained, so the audit treats it as a closed leaf. */
export const referenceSchema = (kind: AssistantReferenceKind) => z.string().regex(new RegExp(`^\\[\\[${kind}[1-9][0-9]{0,3}\\.g[1-9][0-9]{0,8}\\]\\]$`, "u"));
