import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import {
  ItemAttemptHistoryCursorSchema,
  ITEM_ATTEMPT_HISTORY_MAX_ENTRIES,
  ItemAttemptHistoryRequestSchema,
  ItemAttemptHistoryResponseSchema,
  type ItemAttemptHistoryCursor,
  type ItemAttemptHistoryRequest,
  type ItemAttemptHistoryResponse,
  type ItemAttemptHistoryRun,
} from "../../../models/dashboard/item-attempt-history.js";
import { RunIdSchema } from "../../../rules/identity/ids.js";
import { DateOnlySchema } from "../../../rules/identity/ids.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { DeletedRunRecord } from "../../../models/run/deleted-run.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

type HistoryRun = Extract<ItemAttemptHistoryRun, { disposition: "live" | "archived" }>;

function cursorEncode(cursor: ItemAttemptHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function cursorDecode(value: string): ItemAttemptHistoryCursor | undefined {
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) return undefined;
    const json = decoded.toString("utf8");
    const parsedJson: unknown = JSON.parse(json);
    const cursor = ItemAttemptHistoryCursorSchema.safeParse(parsedJson);
    return cursor.success ? cursor.data : undefined;
  } catch {
    return undefined;
  }
}

function historyRunOf(run: RunRecord, disposition: "live" | "archived"): HistoryRun {
  return {
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    attempt: run.envelope.attempt,
    disposition,
    rowRevision: run.version,
    partitionDay: DateOnlySchema.parse(searchPartitionDay(new Date(run.envelope.enqueuedAt))),
  };
}

function deletedRunOf(tombstone: DeletedRunRecord) {
  if (tombstone.itemId === null) return undefined;
  return {
    runId: tombstone.runId,
    workflowId: tombstone.workflow,
    itemId: tombstone.itemId,
    attempt: tombstone.attempt,
    disposition: "deleted" as const,
    deletedAt: tombstone.deletedAt,
  };
}

function byAttemptThenRunId(left: ItemAttemptHistoryRun, right: ItemAttemptHistoryRun): number {
  const leftAttempt = left.attempt;
  const rightAttempt = right.attempt;
  if (leftAttempt === null && rightAttempt !== null) return 1;
  if (leftAttempt !== null && rightAttempt === null) return -1;
  if (leftAttempt !== null && rightAttempt !== null && leftAttempt !== rightAttempt) {
    return leftAttempt - rightAttempt;
  }
  return left.runId.localeCompare(right.runId);
}

function selectedPresentOf(run: RunRecord, disposition: "live" | "archived") {
  return {
    state: "present" as const,
    disposition,
    runId: run.envelope.runId,
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    attempt: run.envelope.attempt,
    rowRevision: run.version,
  };
}

function selectedDeletedOf(tombstone: DeletedRunRecord) {
  return {
    state: "deleted" as const,
    disposition: "deleted" as const,
    runId: tombstone.runId,
    workflowId: tombstone.workflow,
    itemId: tombstone.itemId,
    attempt: tombstone.attempt,
    deletedAt: tombstone.deletedAt,
  };
}

function selectedAbsentOf(runId: string) {
  return { state: "absent" as const, disposition: "absent" as const, runId };
}

/** Reads same-item lifecycle authority from one generation-bound snapshot. */
export function createItemAttemptHistoryQuery(input: {
  readonly database: AuthorityDatabase;
  readonly reader: Pick<RunRecordService, "read">;
}) {
  const { database, reader } = input;

  function read(unparsedRunId: string, unparsedRequest: ItemAttemptHistoryRequest): ItemAttemptHistoryResponse {
    const runId = RunIdSchema.parse(unparsedRunId);
    const request = ItemAttemptHistoryRequestSchema.parse(unparsedRequest);
    const cursor = request.cursor === undefined ? undefined : cursorDecode(request.cursor);
    if (request.cursor !== undefined && cursor === undefined) {
      return ItemAttemptHistoryResponseSchema.parse({
        schemaVersion: 1, state: "refused", selectedRunId: runId,
        reason: "malformed-cursor",
      });
    }
    if (cursor !== undefined && cursor.selectedRunId !== runId) {
      return ItemAttemptHistoryResponseSchema.parse({
        schemaVersion: 1, state: "refused", selectedRunId: runId,
        reason: "cursor-run-mismatch",
      });
    }
    if (cursor !== undefined && cursor.limit !== request.limit) {
      return ItemAttemptHistoryResponseSchema.parse({
        schemaVersion: 1, state: "refused", selectedRunId: runId,
        reason: "page-size-changed",
      });
    }

    return database.withAuthorityReadSnapshot(() => {
      const authorityGeneration = database.getMeta().authorityGeneration;
      if (cursor !== undefined && cursor.authorityGeneration !== authorityGeneration) {
        return ItemAttemptHistoryResponseSchema.parse({
          schemaVersion: 1, state: "stale", selectedRunId: runId,
          reason: "authority-changed",
        });
      }

      const existence = reader.read(runId);
      if (existence.state === "absent") {
        return ItemAttemptHistoryResponseSchema.parse({
          schemaVersion: 1, state: "unavailable", selected: selectedAbsentOf(runId), reason: "run-not-found",
        });
      }
      if (existence.state === "deleted" && existence.tombstone.itemId === null) {
        return ItemAttemptHistoryResponseSchema.parse({
          schemaVersion: 1, state: "unavailable", selected: selectedDeletedOf(existence.tombstone),
          reason: "item-identity-unknown",
        });
      }

      const workflowId = existence.state === "present" ? existence.run.envelope.workflow : existence.tombstone.workflow;
      const itemId = existence.state === "present" ? existence.run.envelope.itemId : existence.tombstone.itemId;
      if (itemId === null) {
        throw new Error(`attempt-history-item-identity-missing:${runId}`);
      }
      if (cursor !== undefined && (cursor.workflowId !== workflowId || cursor.itemId !== itemId)) {
        return ItemAttemptHistoryResponseSchema.parse({
          schemaVersion: 1, state: "refused", selectedRunId: runId,
          reason: "cursor-item-mismatch",
        });
      }

      const sources = database.listItemAttemptHistorySources({
        workflow: workflowId,
        itemId,
        sourceLimit: ITEM_ATTEMPT_HISTORY_MAX_ENTRIES + 1,
      });
      if (sources.counts.live + sources.counts.archiveTransfers + sources.counts.deleted > ITEM_ATTEMPT_HISTORY_MAX_ENTRIES) {
        return ItemAttemptHistoryResponseSchema.parse({
          schemaVersion: 1, state: "refused", selectedRunId: runId,
          reason: "item-history-bound-exceeded",
        });
      }

      const candidates = new Map<string, ItemAttemptHistoryRun>();
      const sourceRunIds = new Set<string>();
      const claimSourceId = (candidateRunId: string) => {
        if (sourceRunIds.has(candidateRunId)) throw new Error(`attempt-history-authority-collision:${candidateRunId}`);
        sourceRunIds.add(candidateRunId);
      };
      const add = (entry: ItemAttemptHistoryRun) => {
        candidates.set(entry.runId, entry);
      };

      for (const run of sources.live) {
        claimSourceId(run.envelope.runId);
        const existence = reader.read(run.envelope.runId);
        const archivedInAuthority = database.authority.archivedRuns.isArchived(run.envelope.runId);
        if (existence.state !== "present"
          || existence.disposition !== (archivedInAuthority ? "archived" : "live")
          || existence.run.envelope.runId !== run.envelope.runId
          || existence.run.envelope.workflow !== workflowId
          || existence.run.envelope.itemId !== itemId
          || canonicalJsonStringify(existence.run) !== canonicalJsonStringify(run)) {
          throw new Error(`attempt-history-live-custody-mismatch:${run.envelope.runId}`);
        }
        add(historyRunOf(run, existence.disposition));
      }
      for (const archiveTransferId of sources.archiveTransferIds) {
        claimSourceId(archiveTransferId);
        const transfer = database.transferredRun(archiveTransferId);
        if (transfer === undefined) throw new Error(`attempt-history-archive-transfer-missing:${archiveTransferId}`);
        const existence = reader.read(archiveTransferId);
        if (existence.state !== "present" || existence.disposition !== "archived"
          || existence.run.envelope.workflow !== workflowId || existence.run.envelope.itemId !== itemId
          || canonicalJsonStringify(existence.run) !== canonicalJsonStringify(transfer.run)) {
          throw new Error(`attempt-history-archive-custody-mismatch:${archiveTransferId}`);
        }
        add(historyRunOf(transfer.run, "archived"));
      }
      for (const tombstone of sources.deleted) {
        claimSourceId(tombstone.runId);
        if (tombstone.itemId === null) throw new Error(`attempt-history-null-tombstone-in-item-query:${tombstone.runId}`);
        const existence = reader.read(tombstone.runId);
        if (existence.state !== "deleted"
          || canonicalJsonStringify(existence.tombstone) !== canonicalJsonStringify(tombstone)) {
          throw new Error(`attempt-history-deleted-custody-mismatch:${tombstone.runId}`);
        }
        const entry = deletedRunOf(tombstone);
        if (entry !== undefined) add(entry);
      }

      const selected = existence.state === "present"
        ? selectedPresentOf(existence.run, existence.disposition)
        : selectedDeletedOf(existence.tombstone);
      if (!candidates.has(runId)) throw new Error(`attempt-history-selected-run-missing-from-item-authority:${runId}`);

      const entries = [...candidates.values()].sort(byAttemptThenRunId);
      const offset = cursor?.offset ?? 0;
      if (offset >= entries.length || offset % request.limit !== 0) {
        return ItemAttemptHistoryResponseSchema.parse({
          schemaVersion: 1, state: "refused", selectedRunId: runId, reason: "invalid-offset",
        });
      }
      const pageEntries = entries.slice(offset, offset + request.limit);
      const nextOffset = offset + pageEntries.length;
      const nextCursor = nextOffset < entries.length
        ? cursorEncode({
          schemaVersion: 1,
          selectedRunId: runId,
          workflowId,
          itemId,
          authorityGeneration,
          offset: nextOffset,
          limit: request.limit,
        })
        : null;

      return ItemAttemptHistoryResponseSchema.parse({
        schemaVersion: 1,
        state: "available",
        selected,
        item: { workflowId, itemId },
        page: { limit: request.limit, offset, totalEntries: entries.length, entries: pageEntries, nextCursor },
      });
    });
  }

  return Object.freeze({ read });
}
