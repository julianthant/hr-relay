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
    "sha256": "23a6f94a1b8f6209dbe8fa3133aca38d66ee1c0f1da4df7c12bc606dd47c7319",
    "reason": "Initial refresh publishes catalog failure; conflict and reload refresh rejections already publish readProblem with SETTINGS_REFRESH_UNAVAILABLE and retain the verified document and local drafts while admission stays blocked. SettingsReadSuperseded revokes obsolete observation settlement without publishing a current failure or accepting stale readback; command attempts and uncertainty are retained."
},
  {
    "path": "src/dashboard/surfaces/settings/providers/settings-protected-model.ts",
    "sha256": "558f28727e4d9d0739fb2e2ed2052ae1ee08f96bfa834f7a33aaa34652037451",
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
    "path": "src/models/dashboard/activity-volume.ts",
    "sha256": "e86030a210690c7f06ee550063b628ac9f113a2321d1e02a16b70aa8e17b25a0",
    "reason": "Invalid IANA zones fail the validation predicate; public callers reject with named errors without substituting a zone."
  },
  {
    "path": "src/backend/storage/admission/installation.ts",
      "sha256": "24a9a05814b884552d00853e072db45d6f15360c70aa220488a70ca36d8a1771",
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
    "sha256": "0a461642d4dc9a9278b761c9663bde7d5f98afec99d94c4b573721afe1be5e6f",
    "reason": "Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/backend/runtime/workers/worker-supervisor.ts",
    "sha256": "14218910fac62ae2758e13e576075716a1f4e6c662efa1ffd543570fb0d24231",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
  },
  {
    "path": "src/backend/logs/browser-action-drain.ts",
    "sha256": "e9b09cc2f9407f5b52a3ea9ae3389b649b63ab7d559d62fdc99928a2654589a3",
    "reason": "A failed note warn records warningFailed and keeps draining; a failed health report records report-failed. Neither invents delivered notes from a diagnostic failure; task screenshot failures are retained for caller settlement."
  },
  {
    "path": "src/backend/logs/confirmed-action-publisher.ts",
    "sha256": "ef0e6fa2ebeb8700620def7ad4ee262c6899d7f0d1a96ec3f79cfddbbcb837a1",
    "reason": "A failing health observer sets diagnosticFailure and keeps the publisher's own state; queue acceptance is still never reported as durable delivery."
  },
  {
    "path": "src/dashboard/app/navigation/view-route-model.ts",
    "sha256": "72534f412535070615d068ba54639ad429c9c23ab3efb6ffde12e392974f1038",
    "reason": "Oversized or invalid view-route JSON returns null; the caller treats the route as unreadable instead of rebuilding shell navigation from a default."
  },
  {
    "path": "src/backend/storage/sqlite/authority-boot.ts",
    "sha256": "a83c56f6def1c1caf87975733313b34dee23f91072c0064cb3030c875083495f",
    "reason": "A failed open or inspection returns degraded-read-only with mutations blocked; only successful close clears the database handle, and uncertain close preserves the handle and aggregate cause."
  },
  {
    "path": "src/backend/storage/sqlite/authority-database.ts",
    "sha256": "257c4d471793335aa7f1766a4aed9df842e4fe5c9fc56ae103880f2dd91bbdd8",
    "reason": "Failed external source validation clears only its admission cache and then throws the original mutation error or run-search-index-rebuild-required; malformed diagnostic reads remain explicit malformed states. Named missing-proof recovery retains the original uncertain operation and barrier without success."
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "sha256": "94d4a879d2ff657978eb68e5034feb8244d621fcf5f4f65e0312c3c8d4135749",
    "reason": "Only ENOENT denotes an absent optional sidecar; a missing main database throws, unsafe or changed inputs throw, and failed construction disposes only its private snapshot before rethrowing."
  },
  {
    "path": "src/backend/storage/sqlite/runtime-process-locks.ts",
    "sha256": "54d8b454da8c214b8cdfa69415080141497eb8853b97484c365204cd39002a64",
    "reason": "Failed admission releases custody only after the opened resource closes successfully; close and release failures remain aggregate errors, uncertain resources keep their custody, and the original admission error always rejects."
  },
  {
    "path": "src/backend/systems/browser-shared/ucsd-sso.ts",
    "sha256": "839a651d275ebd4ddb441b4bc624c8aaaf1fa124f0d7216a9f36b7ae0ebbf03a",
    "reason": "Stall probes report explicit unknown codes (landing-probe-unavailable, duo-refusal-unproven); every stalled landing still throws BrowserLandingStallError or DuoTerminalRefusalError, the refusal, stale-request, and training-reminder observers leave observation timeout and diagnosis to the landing wait, and training-reminder click failures remain explicit BrowserLoginError failures. Initiated bound-element clicks drain before landing or cancellation settles; compound click, disposal, and landing failures retain their original causes."
  },
  {
    "path": "src/dashboard/state/activity-wiring-adapter.ts",
    "sha256": "eb13c5569e7fa09692b3093371ac4854f9bc36dbad99733f32dff3154530b007",
    "reason": "The population observation consumes a rejection only after createSettingsRead publishes failed with its held selection. useActivityWiring exposes the catalog notice and revokes exports/navigation, preserving a coherent completed report and browse as history; superseded reads cannot publish or replace the current pair."
},
  {
    "path": "src/dashboard/state/explorer-wiring-adapter.ts",
    "sha256": "b9b41d1b15445acbb266b9dc7a19ea63f69942440f593cc6307bb42d2f5d451e",
    "reason": "createSettingsRead publishes failed before its observation rejects. useExplorerWiring returns a catalog refusal and its exact retained projection; WorkflowExplorer renders the failure beside held timeline and sources. Superseded authority observations cannot restore old definitions."
},
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-facts-model.ts",
    "sha256": "e9c2c3608b6b658b7002788795b478265e8211b3a82fd4f8d4ff96d20ad516b3",
    "reason": "createSettingsRead publishes failed before the facts observation rejects. useSettingsFacts returns SETTINGS_INITIAL_READ_UNAVAILABLE with any held facts, and FactsPane renders the catalog failure beside those exact facts; superseded identity reads cannot publish."
},
  {
    "path": "src/dashboard/surfaces/settings/storage/storage-settings-model.ts",
    "sha256": "074755a01314e9e42d94c6798ba9fefa176b7c5737824154751ea634308fe9b8",
    "reason": "Latest and full doctor read resources publish failed before observers consume rejection. useStorageDoctor exposes STORAGE_DOCTOR_FAILED with the exact held report; StorageSection renders that catalog failure and preserves diagnostic findings. Superseded observations cannot replace authority; stale-check marker prevents automatic retry after failure, while explicit operator retry remains available."
}
] as const;
