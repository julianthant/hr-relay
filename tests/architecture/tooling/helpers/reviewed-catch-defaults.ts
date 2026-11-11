export interface ReviewedCatchDefault {
  readonly path: string;
  readonly reason: string;
  readonly statements: readonly {
    readonly kind: "try" | "promise";
    readonly sha256: string;
    readonly occurrences: number;
  }[];
}

export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/backend/profiles/profile-onboarding.ts",
    "reason": "A rejected opening clears only its lease's in-flight Show marker and binds the observed browser generation. The catch records and rethrows the original failure, attempts exact attempt closure, and aggregates retention or cleanup failures. It supplies no success, authority or closure default. Late Show failure controls preserve retired-resource custody after proved Reopen and retain foreign source failures.",
    "statements": [
      {
        "kind": "try",
        "sha256": "d3eafd256dab0eb2806500d5113268377709d7a508e215bc8bcd59e93d73f17d",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/artifacts/named-file-output-sink.ts",
    "reason": "Only ENOENT denotes an absent publication destination or parent directory. The sink checks absence before exclusive creation, refuses disappeared retained directory identities, and propagates every other stat error. Staging, publication and close failures remain explicit or retain their original causes as custody uncertainty.",
    "statements": [
      {
        "kind": "try",
        "sha256": "177199ce6fd8b453c7da6bbae65d93515f09e21a73bc076f09e15c0f749d334a",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/runs/queries/run-detail/receipts-failures.ts",
    "reason": "Only the canonical typed RerunRefusedError suppresses an unavailable failure or gate correction request; it grants no correction, lookup or retry. Unexpected snapshot, custody or validation failures propagate. Separate negative controls verify typed refusal and original unexpected-error propagation.",
    "statements": [
      {
        "kind": "try",
        "sha256": "63b8b59f846e56ec3406287530347a48dd18b00fccb9a8f98ca06a26537668ab",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/runtime/browser/onboarding-duo-provider.ts",
    "reason": "Failed UNKNOWN retention or failure callbacks retain both causes and keep closure unproved. The browser pump sends a negative acknowledgment on request failure, revokes before retaining its original failure, and aggregates diagnostic-report failures without retrying a failed sink. Only a Playwright target-close poll failure whose worker did not close before its context may settle with context closing. Genuine poll failures keep their original causes even when closing overtakes their asynchronous catches or a prior failure is already reporting; closing status never substitutes for its event or native proof. A macOS return-to-Relay focus refusal logs its closed diagnostic and preserves the Duo state. Setup and slow-warning failures keep their original causes and attempt existing physical closure. Captured software keys stay UNKNOWN; diagnostic failure alone does not make proved physical closure uncertain. Profile removal and replacement still require settled callbacks, exact owner/private paths and native closure proofs; native failures never trigger a second ceremony.",
    "statements": [
      {
        "kind": "try",
        "sha256": "d829b3bec1a13f0d2c76ce2c9cce158832bca04ed078efb78ffef6b95148fd15",
        "occurrences": 1
      },
      {
        "kind": "promise",
        "sha256": "21939e260f26d984c93603c198248d2a5888919a6957d47ac5d305c3f4bcaa58",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/app/composition/dashboard/runtime-resources.ts",
    "reason": "Startup producer closure failures retain dependent native database and admission custody. Selected-context open failure rethrows typed custody uncertainty. Root lifetime transfer failure kills the spawned child and emits the original error; shutdown awaits owned child closure. Rejection observers preserve the original lifetime and stop promises, whose callers await failures before storage release. An unavailable authority generation remains explicitly unavailable; backup presence is assessed separately. Automatic upgrade runs before composition in storage-compose.ts and has no HTTP response handoff. Confirmed account deletion shares the exact session logout drain; deletion errors propagate with pending identity retained and never report signed-out success.",
    "statements": [
      {
        "kind": "try",
        "sha256": "ee18655defb027768cebf035aca42d85e3f20db705b56d9895f3e3f1727ec916",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/app/composition/worker-compose.ts",
    "reason": "The bound native open validates authority in one SQLite snapshot before protected values are read. Failed opening cleanup retains the actual native database, issued admission and both original/close errors as custody uncertainty. Other open failures close the actual database before admission release and aggregate cleanup errors. Runtime cleanup releases admission only after proven database and browser closure. An uncertain launch reports launch-uncertain with custody held and leaves the lease unchanged. Maintenance failure stops rescheduling and signals the worker stop controller; composition surfaces the failure. Actual root or inherited lifetime custody remains held through shutdown.",
    "statements": [
      {
        "kind": "try",
        "sha256": "a9fd279c4dac1a7671de184a4463375be1496930f0211f618fb1fe3f89b5cbaa",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/accounts/chatgpt-account-service.ts",
    "reason": "The empty catch drains only the rejection of an invalid Promise-valued synchronous authority check; assertAssistantCurrent immediately throws CHATGPT_ASSISTANT_REFUSED unless the result is exactly true. No account authority or availability is substituted. A reader is released only after successful cancel/release or matching typed cancellation proof; other closure failures retain the exact reader and response as resource uncertainty. Other catches publish explicit errors or unconfirmed revocation.",
    "statements": [
      {
        "kind": "try",
        "sha256": "5c0efea2dd65f264a6bd373d34dbffc0d63f9acbb0e1216113dfeee1e44162d0",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/artifacts/content-addressed-artifact-writer.ts",
    "reason": "Only ENOENT denotes no diagnostic stage directory (empty inventory, zero reclaimed stages or bytes) or an already absent captured file; all other errors rethrow. EEXIST verifies exact winner bytes; custody and cleanup failures throw or aggregate.",
    "statements": [
      {
        "kind": "try",
        "sha256": "51f359b7eab4fbc82b3ecadfb4a367a33ac34d2ad6cc0f4484f85a993638f504",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "456840c0df9943a924b575468bdfb1eddb126aad11da7299659a65ce12b6e8fb",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "561d6c2837ad01ac131c22b623f6114c6b60c107301eb624574080c9ba7cd4ef",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "reason": "ENOENT alone denotes no backup directory; failed authority, credential, recovery or backup inspection publishes explicit unavailable, degraded or invalid health, and failed logical backup identity verification makes restore unavailable.",
    "statements": [
      {
        "kind": "try",
        "sha256": "7202198420def93086d550ceeedc451ad5cd447bc7d2c9dd08364797433b206e",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "35b15170c232cccf531eed4e1a5ba4823afc7fa9e7302726923291936931ae5c",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/app/composition/dashboard/notification-health.ts",
    "reason": "Failure booleans trigger explicit failed health notifications; they never claim a healthy read.",
    "statements": [
      {
        "kind": "try",
        "sha256": "ab17fb3fde0f559f8d5fd8667fc0fe8e8397089a9c9a0e711312d1ad3a5351fa",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "ed6812db1450ece2d020d475af33b5824c8bc2e0cc86c9acc7b259209761070c",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-editor-model.ts",
    "reason": "Initial refresh publishes catalog failure; conflict and reload refresh rejections already publish readProblem with SETTINGS_REFRESH_UNAVAILABLE and retain the verified document and local drafts while admission stays blocked. SettingsReadSuperseded revokes obsolete observation settlement without publishing a current failure or accepting stale readback; command attempts and uncertainty are retained.",
    "statements": [
      {
        "kind": "promise",
        "sha256": "3a87df78af25ed2ebe5cadec2234e4ee9984bc543c9439342de36d723994ee20",
        "occurrences": 2
      }
    ]
  },
  {
    "path": "src/dashboard/surfaces/settings/providers/settings-protected-model.ts",
    "reason": "Only a before-effect refusal clears the attempt; unknown writes retain the exact attempt and draft and publish unconfirmed.",
    "statements": [
      {
        "kind": "promise",
        "sha256": "71f763c2197751ea7e383e8de2206f4b3616baec0f0c44d33c985a596221bd6a",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/app/navigation/archive-route-model.ts",
    "reason": "Oversized or malformed supplied route JSON returns null; the URL-state caller marks archiveBrowseInvalid instead of substituting a parsed route.",
    "statements": [
      {
        "kind": "try",
        "sha256": "226f2bc4346dbd0f1b1d7b9afb47ec56fe677be893e7cad94e8ccb061eb31227",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/ds/primitives/primitives-date.tsx",
    "reason": "Invalid editable dates remain invalid without substitution; a supplied invalid bound now throws DS_DATE_BOUND_INVALID instead of silently dropping the constraint.",
    "statements": [
      {
        "kind": "try",
        "sha256": "65beca141e0c52bb1a195fa19f09b82703b4a58b2eae862d7eccbcff347f78ea",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/models/dashboard/activity-volume.ts",
    "reason": "Invalid IANA zones fail the validation predicate; public callers reject with named errors without substituting a zone.",
    "statements": [
      {
        "kind": "try",
        "sha256": "eef22a90cf882c53937a089f947e004e9f5dedb89387d366c3b8bb1c0237d21e",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/runs/commands/ordinary-path-validator.ts",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal.",
    "statements": [
      {
        "kind": "try",
        "sha256": "4a6869d722bb27dc0d10590ee6ae6f8672649c6221800d556bf91ad61888b73c",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/transports/http/native-path-picker.ts",
    "reason": "Invalid or unavailable selected paths become explicit dialog-failed responses; cancellation has its own exact marker.",
    "statements": [
      {
        "kind": "try",
        "sha256": "9f9bef4e2646c2c73c70794fa1aa8498b231839e7314028a1f4b480d60f0add0",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/runs/queries/item-attempt-history.ts",
    "reason": "Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests.",
    "statements": [
      {
        "kind": "try",
        "sha256": "a7c5ff55f17d953a97ca92a59ee1cbe0dcc1041f3bd0776bbfcd0996d4480612",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/runtime/workers/worker-pool.ts",
    "reason": "A failed re-settlement of a prior exit keeps that failure as settlementFailure, releases the settling reservation and throws WORKER_EXIT_SETTLEMENT_FAILED with the cause; a failed spawn releases the reservation and rethrows. Neither marks the exit settled nor publishes a member.",
    "statements": [
      {
        "kind": "try",
        "sha256": "c0e13aa136ee1dede2bf1a5a57ae05a6bec578b62a5bceb73a6535f71f133952",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "1d80392a765f5b88bd188fb97f28377e942a17f5f7416f27bb6c53ab133c79b2",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/sqlite/worker-custody-migration.ts",
    "reason": "Only RunDeletionRefusedError with reason shared-checkpoint skips the closure deletion; the conversion removes its own unexecuted deletion command and returns no command id, so the run stays. Every other preflight failure propagates and aborts the migration.",
    "statements": [
      {
        "kind": "try",
        "sha256": "7a946b25fdacd1a1cc7f2dbce85c2f67b93d59b7a04716dce89aa63e221bbd8f",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/logs/browser-action-drain.ts",
    "reason": "A failed note warn records warningFailed and keeps draining; a failed health report records report-failed. Neither invents delivered notes from a diagnostic failure; task screenshot failures are retained for caller settlement.",
    "statements": [
      {
        "kind": "try",
        "sha256": "9c59437cf045b0f797210c463184928858331ca07730ba82cb25fdce33a6b5ef",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/app/navigation/view-route-model.ts",
    "reason": "Oversized or invalid view-route JSON returns null; the caller treats the route as unreadable instead of rebuilding shell navigation from a default.",
    "statements": [
      {
        "kind": "try",
        "sha256": "303999c0206ec8cdda7ca46427ee4ae3097555b3a2e94e98c6a2b95061dd0ebe",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/sqlite/authority-boot.ts",
    "reason": "A failed open or inspection returns degraded-read-only with mutations blocked; only successful close clears the database handle, and uncertain close preserves the handle and aggregate cause.",
    "statements": [
      {
        "kind": "try",
        "sha256": "cdcd384cd125be140cfe07817e6623892f7d13d2ee0ad5ea83a188113f061dbe",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/sqlite/readonly-authority-snapshot.ts",
    "reason": "Only ENOENT returns absent source metadata; the caller rejects a missing main database and permits absent optional sidecars. Unsafe or changed sources throw. Construction and read failures rethrow after private cleanup; failed database close or snapshot disposal retains the resource owners and original causes as source-closure uncertainty, never a read result.",
    "statements": [
      {
        "kind": "try",
        "sha256": "c24d0a160752bf3779255ae247c7c3660c3bcb15d0d2f7214ee10b51c1830916",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/systems/browser-shared/ucsd-sso.ts",
    "reason": "The navigation rejection observer preserves the original promise raced by the training-reminder wait; the landing wait owns timeout and diagnosis. An empty diagnostic title accompanies LANDING_PROBE_UNAVAILABLE and a thrown BrowserLandingStallError with the original landing cause, never authenticated success. Probe uncertainty stays explicit; initiated clicks drain before settlement, and compound click, disposal and landing failures retain their causes. Pinned credential submission attempts every handle disposal and rethrows the primary error or aggregates all cleanup failures.",
    "statements": [
      {
        "kind": "promise",
        "sha256": "768fb96d69e3a31face89c887d84043269b187d977b8a0afbef2aefbecbd8dfe",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "a9f46b892ae9f83022af52bae910f774b5d09cc5b542e1672bd5b4f1df1135f1",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/state/activity-wiring-adapter.ts",
    "reason": "The population observation consumes a rejection only after createSettingsRead publishes failed with its held selection. useActivityWiring exposes the catalog notice and revokes exports/navigation, preserving a coherent completed report and browse as history; superseded reads cannot publish or replace the current pair.",
    "statements": [
      {
        "kind": "promise",
        "sha256": "2aeb83d1ee3c28a041cfb4da4cd848df507e08bff34f34478ccf0c6b039692ed",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-facts-model.ts",
    "reason": "createSettingsRead publishes failed before the facts observation rejects. useSettingsFacts returns SETTINGS_INITIAL_READ_UNAVAILABLE with any held facts, and FactsPane renders the catalog failure beside those exact facts; superseded identity reads cannot publish.",
    "statements": [
      {
        "kind": "promise",
        "sha256": "54e0a82aafc7827b544c7831298fcaaaae9a085c95802852e7ab4fae379a9d08",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/dashboard/surfaces/spreadsheets/spreadsheet-fields-model.ts",
    "reason": "Only CellCoercionError or ZodError makes the field-validation predicate false; the caller marks the supplied value invalid. Unknown field IDs and unexpected errors throw. Blank cells are explicitly optional and never substituted.",
    "statements": [
      {
        "kind": "try",
        "sha256": "637072d213c891a72615e01cf154fa8d735f9ab44325bded38569c7f479f5314",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/app/bootstrap/secure-env-bootstrap.ts",
    "reason": "The root listener or inherited lifetime is acquired before admission. Unproved source closure retains admission and rethrows; typed runtime or source-closure uncertainty retains the outer lifetime, while settled paths await its close. Stopped maintenance releases admission only when custody was not retained. No failed bootstrap becomes successful runtime admission. The real browser closure port is supplied to dashboard admission and offline cancellation without changing the failure-retention path. Layout preparation rethrows typed person-upgrade and automatic-repair refusals unchanged; other layout failures preserve their cause before ordinary admission, so nested closure uncertainty retains the same root listener.",
    "statements": [
      {
        "kind": "try",
        "sha256": "4fda8ade33505067575dc04d404c5df161c78980321f39d34154ef5681bfdd26",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/admission/process-root.ts",
    "reason": "Only ENOENT reports explicit control-path absence. Callers check absence before creation or permit a missing old-build process root; other filesystem failures rethrow. Existing roots must pass ancestry and private-directory checks, and any artifact produces the named old-build refusal.",
    "statements": [
      {
        "kind": "try",
        "sha256": "cf7547e8951237280e86614431dda1a5b40ffa35d5e582558bf8e0dfc80fa9b6",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/configuration/canonical-credential-store.ts",
    "reason": "The catch revokes the asynchronous ChatGPT lease by clearing its active flag, retains any unproved source and exact process lock, and rethrows the settled body error or translates the failure to a named credential refusal. It never substitutes a credential record or successful result. Other catches preserve explicit busy, unavailable, pending or uncertain failures and retain source owners before rethrowing.",
    "statements": [
      {
        "kind": "try",
        "sha256": "d87f16382d5f2f2dad774c8254a1004cc221a7c2cf7de78cf3a4c38c99a5e9b5",
        "occurrences": 1
      }
    ]
  },
  {
    "path": "src/backend/storage/sqlite/backup-inspection.ts",
    "reason": "Snapshot and database cleanup failures accumulate and rethrow as source-closure uncertainty; the empty list is the accumulator, and the original inspection error is never dropped.",
    "statements": [
      {
        "kind": "try",
        "sha256": "16c3a2e98b8766b69146832654c63d83ce829dc1db275dc0e4bd4c4c14e9a73a",
        "occurrences": 1
      },
      {
        "kind": "try",
        "sha256": "bef897604515c49da948c67dae201dd3b051bcdb4da8fb2334ede73fcd0ce35b",
        "occurrences": 1
      }
    ]
  }
] as const satisfies readonly ReviewedCatchDefault[];
