import { z } from "zod";
import {
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

export const ITEM_ATTEMPT_HISTORY_VERSION = 1 as const;
export const ITEM_ATTEMPT_HISTORY_DEFAULT_LIMIT = 25;
export const ITEM_ATTEMPT_HISTORY_MAX_LIMIT = 50;
export const ITEM_ATTEMPT_HISTORY_MAX_ENTRIES = 500;

export const ItemAttemptHistoryRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(ITEM_ATTEMPT_HISTORY_MAX_LIMIT)
    .default(ITEM_ATTEMPT_HISTORY_DEFAULT_LIMIT),
  cursor: z.string().min(1).max(2048).optional(),
});

/** The unsigned cursor binds a page to both its selected run and authority snapshot. */
export const ItemAttemptHistoryCursorSchema = z.strictObject({
  schemaVersion: z.literal(ITEM_ATTEMPT_HISTORY_VERSION),
  selectedRunId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  itemId: ItemIdSchema,
  authorityGeneration: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(ITEM_ATTEMPT_HISTORY_MAX_LIMIT),
});

export const ItemAttemptHistoryRunSchema = z.discriminatedUnion("disposition", [
  z.strictObject({
    disposition: z.literal("live"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema,
    attempt: PositiveIntSchema,
    rowRevision: PositiveIntSchema,
  }),
  z.strictObject({
    disposition: z.literal("archived"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema,
    attempt: PositiveIntSchema,
    rowRevision: PositiveIntSchema,
  }),
  z.strictObject({
    disposition: z.literal("deleted"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema,
    attempt: PositiveIntSchema.nullable(),
    deletedAt: IsoInstantSchema,
  }),
]);

export const ItemAttemptHistorySelectedSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("present"),
    disposition: z.enum(["live", "archived"]),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema,
    attempt: PositiveIntSchema,
    rowRevision: PositiveIntSchema,
  }),
  z.strictObject({
    state: z.literal("deleted"),
    disposition: z.literal("deleted"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    itemId: ItemIdSchema.nullable(),
    attempt: PositiveIntSchema.nullable(),
    deletedAt: IsoInstantSchema,
  }),
  z.strictObject({ state: z.literal("absent"), disposition: z.literal("absent"), runId: RunIdSchema }),
]);

export const ItemAttemptHistoryResponseSchema = z.discriminatedUnion("state", [
  z.strictObject({
    schemaVersion: z.literal(ITEM_ATTEMPT_HISTORY_VERSION),
    state: z.literal("available"),
    selected: ItemAttemptHistorySelectedSchema,
    item: z.strictObject({ workflowId: WorkflowIdSchema, itemId: ItemIdSchema }),
    page: z.strictObject({
      limit: z.number().int().min(1).max(ITEM_ATTEMPT_HISTORY_MAX_LIMIT),
      offset: z.number().int().nonnegative(),
      totalEntries: z.number().int().nonnegative(),
      entries: z.array(ItemAttemptHistoryRunSchema).max(ITEM_ATTEMPT_HISTORY_MAX_LIMIT),
      nextCursor: z.string().max(2048).nullable(),
    }),
  }).superRefine((response, context) => {
    if (response.selected.state === "absent") {
      context.addIssue({ code: "custom", path: ["selected"], message: "available history requires a present or associated deleted run" });
      return;
    }
    if (response.selected.itemId !== response.item.itemId || response.selected.workflowId !== response.item.workflowId) {
      context.addIssue({ code: "custom", path: ["selected"], message: "selected run and history item identity differ" });
    }
    for (const [index, entry] of response.page.entries.entries()) {
      if (entry.itemId !== response.item.itemId || entry.workflowId !== response.item.workflowId) {
        context.addIssue({ code: "custom", path: ["page", "entries", index], message: "attempt entry belongs to another item" });
      }
    }
    if (response.page.offset + response.page.entries.length > response.page.totalEntries) {
      context.addIssue({ code: "custom", path: ["page"], message: "page exceeds the history total" });
    }
  }),
  z.strictObject({
    schemaVersion: z.literal(ITEM_ATTEMPT_HISTORY_VERSION),
    state: z.literal("unavailable"),
    selected: ItemAttemptHistorySelectedSchema,
    reason: z.enum(["run-not-found", "item-identity-unknown"]),
  }),
  z.strictObject({
    schemaVersion: z.literal(ITEM_ATTEMPT_HISTORY_VERSION),
    state: z.literal("stale"),
    selectedRunId: RunIdSchema,
    reason: z.literal("authority-changed"),
  }),
  z.strictObject({
    schemaVersion: z.literal(ITEM_ATTEMPT_HISTORY_VERSION),
    state: z.literal("refused"),
    selectedRunId: RunIdSchema,
    reason: z.enum([
      "malformed-cursor",
      "cursor-run-mismatch",
      "cursor-item-mismatch",
      "page-size-changed",
      "invalid-offset",
      "item-history-bound-exceeded",
    ]),
  }),
]);

export type ItemAttemptHistoryRequest = z.infer<typeof ItemAttemptHistoryRequestSchema>;
export type ItemAttemptHistoryCursor = z.infer<typeof ItemAttemptHistoryCursorSchema>;
export type ItemAttemptHistoryRun = z.infer<typeof ItemAttemptHistoryRunSchema>;
export type ItemAttemptHistorySelected = z.infer<typeof ItemAttemptHistorySelectedSchema>;
export type ItemAttemptHistoryResponse = z.infer<typeof ItemAttemptHistoryResponseSchema>;
