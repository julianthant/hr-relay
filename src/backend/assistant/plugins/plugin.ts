import { z } from "zod";
import type { AssistantActionProposal, AssistantFailureCode, AssistantM2ProposalOptions, AssistantM2ProposalRow, AssistantToolTier } from "../../../models/dashboard/assistant.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { AssistantReferenceKind, AssistantReferenceTable } from "../references.js";

/** Where an output leaf's value comes from; only these origins may reach the model. */
export type AssistantToolLeafOrigin = "repository-authored" | "declared-redacted";
export interface AssistantToolContext {
  readonly signal: AbortSignal;
  readonly references: AssistantReferenceTable;
  readonly actorId: string;
  /** The conversation whose accepted turn issued this call; a decision caption is bound to it. */
  readonly conversationId: string;
  /** This turn's masked operator message; typed names and links must appear in it verbatim. */
  readonly operatorText: string;
  assertCurrent(): void;
  /** The turn's captured authority (composition, model policy, account) without its request signal; a proposal keeps it for Confirm. */
  assertRetainedCurrent(): void;
}
interface AssistantToolIdentity {
  readonly name: string;
  readonly tier: AssistantToolTier;
  readonly description: string;
  readonly parameters: z.ZodType;
}
export interface AssistantReadTool extends AssistantToolIdentity {
  readonly kind: "read";
  readonly output: z.ZodType;
  /** Every output leaf path with its origin; the redaction audit registers it as this tool's process-egress surface. */
  readonly privacy: readonly Readonly<{ path: string; origin: AssistantToolLeafOrigin }>[];
  invoke(argumentsValue: unknown, context: AssistantToolContext): Promise<JsonValue>;
}
/** Prepares one confirmation card; its result goes to the operator, never back to the model, and ends the turn. */
export interface AssistantProposalTool extends AssistantToolIdentity {
  readonly kind: "proposal";
  propose(argumentsValue: unknown, context: AssistantToolContext): Promise<AssistantActionProposal>;
}
/** A small local change (no run) that applies inside the turn without a card; its output returns to the model. */
export interface AssistantChangeTool extends Omit<AssistantReadTool, "kind"> {
  readonly kind: "change";
}
/** Names one session start; the dispatch owner admits it with the turn's accepted identity. Its output returns to the model. */
export interface AssistantSessionTool extends Omit<AssistantReadTool, "kind" | "invoke"> {
  readonly kind: "session";
  request(argumentsValue: unknown, context: AssistantToolContext): Readonly<{ workflowId: string; entries: readonly string[] }>;
}
/** What one typed-yes proposal will do, from fresh plans; Relay renders it and only the operator's typed yes runs it. */
export type AssistantProposalDraft = Readonly<{ label: string; dryRun: boolean; options: AssistantM2ProposalOptions | null; rows: readonly Omit<AssistantM2ProposalRow, "id" | "ordinal">[] }>;
/** Prepares one typed-yes proposal; its output (status and row count) returns to the model and the turn continues. */
export interface AssistantTypedProposalTool extends Omit<AssistantReadTool, "kind" | "invoke"> {
  readonly kind: "typed-proposal";
  prepare(argumentsValue: unknown, context: AssistantToolContext): Promise<AssistantProposalDraft>;
}
export type AssistantTool = AssistantReadTool | AssistantChangeTool | AssistantProposalTool | AssistantSessionTool | AssistantTypedProposalTool;
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
