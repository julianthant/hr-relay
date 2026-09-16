import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  ArchiveDeleteCommandRequestSchema,
  type CommandRequest,
  RunLifecycleCommandRecordSchema,
} from "../../../domain/commands.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";
import type { z } from "zod";

type DeleteRequest = Extract<CommandRequest, { type: "delete-archived-run" }>;
type LifecycleRecord = z.infer<typeof RunLifecycleCommandRecordSchema>;

function replayIntent(request: DeleteRequest) {
  const { requestedAt: _requestedAt, source: _source, ...intent } = request;
  void _requestedAt;
  void _source;
  return intent;
}

/** Recover only the BFF-authenticated request retained by canonical Archive deletion. */
export function authenticatedArchiveDeleteRequest(record: LifecycleRecord | undefined): DeleteRequest | undefined {
  if (record?.operation !== "delete-archived") return undefined;
  const request = record.acceptedArchiveDeleteRequest;
  if (request === undefined || request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || request.source !== "dashboard") return undefined;
  return ArchiveDeleteCommandRequestSchema.parse(request);
}

/** A fresh BFF timestamp may be replaced only when every caller-controlled intent field agrees. */
export function bindArchiveDeleteRequest(record: LifecycleRecord | undefined, request: DeleteRequest): DeleteRequest | undefined {
  const retained = authenticatedArchiveDeleteRequest(record);
  if (retained === undefined) return record === undefined ? request : undefined;
  return canonicalJsonStringify(replayIntent(retained)) === canonicalJsonStringify(replayIntent(request))
    ? retained
    : undefined;
}
