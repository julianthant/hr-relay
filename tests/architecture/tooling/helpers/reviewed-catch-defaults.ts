/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/backend/storage/sqlite/explorer-override-conversion.ts",
    "sha256": "bb9d4706dd3430b8850a8859d94f2dc64f0fe61bd7da8d9aa2c8acbf1ae3b108",
    "reason": "ENOENT alone denotes an absent optional legacy file; all other errors propagate."
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "sha256": "50fe30ff5cfe9d0e4e08fa17556780b834c089927b7f67337a011ddfb4b77064",
    "reason": "ENOENT alone denotes no backup directory; failed inspection sets an explicit invalid health flag."
  },
  {
    "path": "src/backend/storage/sqlite/storage-recovery-status.ts",
    "sha256": "cec91793472773d8d9b8f5728511070983268d597d065b9d672d320967f6fa1b",
    "reason": "ENOENT alone proves absent archive; all other errors propagate to unavailable custody."
  },
  {
    "path": "src/backend/app/composition/dashboard/notification-health.ts",
    "sha256": "0c607f7146d081cb7e713bc7358ab8fe06b42a00ea153229a9444db8dd5fb340",
    "reason": "Failure booleans trigger explicit failed health notifications; they never claim a healthy read."
  },
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-editor-model.ts",
    "sha256": "0749e98231804b2cdc52eaad4b928b045efb304451401cae56288f72d325f43e",
    "reason": "A refresh rejection publishes the read failure and still rejects with settings-read-unavailable; drafts are retained. Before-effect refusal clears the attempt, unconfirmed writes retain it."
  },
  {
    "path": "src/dashboard/surfaces/settings/providers/settings-protected-model.ts",
    "sha256": "07940fec811247338a18a8e3f99bd3773271c8316c5e7e63db4ae758c57b2e22",
    "reason": "Only a before-effect refusal clears the attempt; unknown writes retain the exact attempt and draft and publish unconfirmed."
  },
  {
    "path": "src/dashboard/app/navigation/archive-route-model.ts",
    "sha256": "cd3023ebeb1800f3eb54b4cb6f7c68eb8161fbfbc9912b27cbf12dfb7b59a33e",
    "reason": "Oversized or invalid user route JSON returns null; its caller marks the route invalid and blocks Archive exports instead of inventing a route."
  },
  {
    "path": "src/dashboard/ds/primitives/primitives-date.tsx",
    "sha256": "11a1f2b54858f4c97296409ca073c3d1324024c16bd7b395f95a4b4f2bfd1e01",
    "reason": "Invalid editable dates remain invalid without substitution; a supplied invalid bound now throws DS_DATE_BOUND_INVALID instead of silently dropping the constraint."
  },
  {
    "path": "src/dashboard/surfaces/settings/general/settings-relocation-model.ts",
    "sha256": "9b10e21450f6fd8dba65157363b3ee8d000294d6a6284e2eabc5ed1d07c00b71",
    "reason": "Typed before-effect refusal clears only the attempt; unknown writes retain it and publish unconfirmed; unavailable reads lock editing."
  },
  {
    "path": "src/models/dashboard/activity-volume.ts",
    "sha256": "e86030a210690c7f06ee550063b628ac9f113a2321d1e02a16b70aa8e17b25a0",
    "reason": "Invalid IANA zones fail the validation predicate; public callers reject with named errors without substituting a zone."
  },
  {
    "path": "src/backend/storage/admission/installation.ts",
    "sha256": "1e48c429623d4fb00334435c5a7e3ff10afbac67d42cd833b98e7bf4c628d39b",
    "reason": "Only ENOENT denotes path absence; callers validate exact optional-path contracts or refuse missing required entries; other errors propagate."
  },
  {
    "path": "src/backend/runs/commands/ordinary-path-validator.ts",
    "sha256": "9a2eb879cd24377f39eeb5329e9184c9dbc3d17b0366d25455cbb61841b7c09b",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal."
  },
  {
    "path": "src/backend/transports/http/native-path-picker.ts",
    "sha256": "84cd2402e31c892f8376a8efed0e9efeec92b8f0175ba1350fc48e45124c8d36",
    "reason": "Invalid or unavailable selected paths become explicit dialog-failed responses; cancellation has its own exact marker."
  },
  {
    "path": "src/backend/runs/queries/item-attempt-history.ts",
    "sha256": "590f59c4e45c358dc90b3e69809adf30d496a7e90835b03f0df5679b2124a3fb",
    "reason": "Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/backend/runtime/workers/worker-supervisor.ts",
    "sha256": "9de7e351cbd83a7bf780acb7560bd14e2bc4cc85c928294139f71e9ed84fa4c2",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
  },
  {
    "path": "src/backend/storage/maintenance/relocation-inventory.ts",
    "sha256": "279739ef891e91b39cf660757de46e7666b12430adcc810e637e48d005798bd5",
    "reason": "A failed binding rejects that candidate; absence of any verified matching backup throws an unbound preserved-copy error."
  },
  {
    "path": "src/backend/logs/browser-action-drain.ts",
    "sha256": "c4d3b7b97dacccffd5d6b95ee4b5c3079d6bb5558eb80bd1964143a6b7cca6e0",
    "reason": "A failed note warn records warningFailed and keeps draining; a failed health report records report-failed. Neither invents delivered notes from a diagnostic failure."
  },
  {
    "path": "src/backend/logs/confirmed-action-publisher.ts",
    "sha256": "ef0e6fa2ebeb8700620def7ad4ee262c6899d7f0d1a96ec3f79cfddbbcb837a1",
    "reason": "A failing health observer sets diagnosticFailure and keeps the publisher's own state; queue acceptance is still never reported as durable delivery."
  },
  {
    "path": "src/backend/transports/http/subscriptions/run-logs-stream.ts",
    "sha256": "90b4c43520d132f76ab4acd257a2dff619f284f4a42fa78371f54385489483ee",
    "reason": "Subscriber read failures reset only that subscriber with a named error; day or tail failures publish degraded or recovering health and reset the generation. Connections refuse unavailable stream ownership."
  },
  {
    "path": "src/dashboard/app/navigation/view-route-model.ts",
    "sha256": "8fade512cb492ec8e768b01768c3bac48147d40588712091dbdc51256504b7fb",
    "reason": "Oversized or invalid view-route JSON returns null; the caller treats the route as unreadable instead of rebuilding shell navigation from a default."
  }
] as const;
