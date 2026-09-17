import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  ArchiveDeleteCommandRequestSchema,
  type CommandRequest,
  RunLifecycleCommandRecordSchema,
} from "../../../domain/commands.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../domain/ids.js";
import type { z } from "zod";

type DeleteRequest = Extract<CommandRequest, { type: "delete-archived-run" }>;
type LifecycleRecord = z.infer<typeof RunLifecycleCommandRecordSchema>;

function replayIntent(request: DeleteRequest) {
  const { requestedAt: _requestedAt, ...intent } = request;
  void _requestedAt;
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
  if (retained === undefined) {
    if (record === undefined) return request;
    // Historical records authenticate only the exact original envelope. Never
    // derive a browser timestamp from an unauthenticated caller or backfill it.
    return record.operation === "delete-archived" && record.acceptedArchiveDeleteRequest === undefined
      && record.requestFingerprint === sha256Hex(`hrauto:run-lifecycle-command:v1\0delete-archived\0${canonicalJsonStringify(request)}`)
      ? request : undefined;
  }
  return canonicalJsonStringify(replayIntent(retained)) === canonicalJsonStringify(replayIntent(request))
    ? retained
    : undefined;
}
