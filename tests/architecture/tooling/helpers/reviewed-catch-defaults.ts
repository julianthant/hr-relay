/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
      "path": "src/backend/storage/artifacts/content-addressed-artifact-writer.ts",
      "sha256": "f29f3b2441fd4ba24295b36ee5f02072bbcf0347897f30f2b23b6a0e483fafa4",
      "reason": "Only ENOENT denotes no diagnostic stage directory (empty inventory, zero reclaimed stages or bytes) or an already absent captured file; all other errors rethrow. EEXIST verifies exact winner bytes; custody and cleanup failures throw or aggregate."
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "sha256": "c0b7b9c5d59f24df4611e94823fe16cb8a2e35719e74873e21a9b79f5b612e40",
    "reason": "ENOENT alone denotes no backup directory; failed authority, credential, recovery or backup inspection publishes explicit unavailable, degraded or invalid health, and relocation-history verification failure makes restore unavailable."
  },
  {
    "path": "src/backend/app/composition/dashboard/notification-health.ts",
    "sha256": "56ee76a497e98b2ea1c369b50d1ce84b70c6b33fd260315a775a9dab420996f0",
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
    "sha256": "96519e6ef20e4aa19a27df5f8deb8c9bcc6fd0559bee8d0f018798b00fa39458",
    "reason": "Oversized or malformed supplied route JSON returns null; the URL-state caller marks archiveBrowseInvalid instead of substituting a parsed route."
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
    "sha256": "c06db824e19110a400cfc140ff9da4a6649b374bb1865b169c90ac6edda6aad3",
    "reason": "Only ENOENT denotes path absence; callers validate exact optional-path contracts or refuse missing required entries; other errors propagate."
  },
  {
    "path": "src/backend/runs/commands/ordinary-path-validator.ts",
    "sha256": "b432a6baa55c9f3c585213166cd4537698978f69f7eee1241bc107d6390a3f20",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal."
  },
  {
    "path": "src/backend/transports/http/native-path-picker.ts",
    "sha256": "84cd2402e31c892f8376a8efed0e9efeec92b8f0175ba1350fc48e45124c8d36",
    "reason": "Invalid or unavailable selected paths become explicit dialog-failed responses; cancellation has its own exact marker."
  },
  {
    "path": "src/backend/runs/queries/item-attempt-history.ts",
    "sha256": "cf5111910cf1a0277977c0a596f497b94a43d759a3d2359d8da092be4dce046b",
    "reason": "Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/backend/runtime/workers/worker-supervisor.ts",
    "sha256": "7ab8d7fc0e7011711d23910f3361deaf6a1e8eadffb82a095957534bf46f9bf4",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
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
    "path": "src/dashboard/app/navigation/view-route-model.ts",
    "sha256": "8fade512cb492ec8e768b01768c3bac48147d40588712091dbdc51256504b7fb",
    "reason": "Oversized or invalid view-route JSON returns null; the caller treats the route as unreadable instead of rebuilding shell navigation from a default."
  },
  {
    "path": "src/backend/storage/sqlite/authority-boot.ts",
    "sha256": "a83c56f6def1c1caf87975733313b34dee23f91072c0064cb3030c875083495f",
    "reason": "A failed open or inspection returns degraded-read-only with mutations blocked; only successful close clears the database handle, and uncertain close preserves the handle and aggregate cause."
  },
  {
    "path": "src/backend/storage/sqlite/authority-database.ts",
    "sha256": "d2e7991107255c461305d522684ea568e56958b592a8cb668e0df37c7241ddd9",
    "reason": "Failed external source validation clears only its admission cache and then throws the original mutation error or run-search-index-rebuild-required; malformed diagnostic reads remain explicit malformed states."
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "sha256": "94d4a879d2ff657978eb68e5034feb8244d621fcf5f4f65e0312c3c8d4135749",
    "reason": "Only ENOENT denotes an absent optional sidecar; a missing main database throws, unsafe or changed inputs throw, and failed construction disposes only its private snapshot before rethrowing."
  },
  {
    "path": "src/backend/storage/sqlite/runtime-process-locks.ts",
    "sha256": "9ded678f889511af9fa073a7fa73c11b990030ade77cc9550651caabef5515c5",
    "reason": "Failed admission releases custody only after the opened resource closes successfully; close and release failures remain aggregate errors, uncertain resources keep their custody, and the original admission error always rejects."
  },
  {
    "path": "src/backend/systems/browser-shared/ucsd-sso.ts",
    "sha256": "ee1d213ab0d38667ec849a1233fc11eb8f7b35d75f4f14112e1588c6f55f0f65",
    "reason": "Stall probes report explicit unknown codes (landing-probe-unavailable, duo-refusal-unproven); every stalled landing still throws BrowserLandingStallError or DuoTerminalRefusalError, and the refusal and stale-request observers leave timeout and diagnosis to the landing wait."
  }
] as const;
