/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/dashboard/state/notification-delivery.ts",
    "sha256": "ca9a42b8f5f4aea3cbe51c7ee96e130ee913e1dd097478a6b8f758ba49583ad6",
    "reason": "Clears lock ownership and publishes delivery-failed; no success state is invented."
  },
  {
    "path": "src/dashboard/surfaces/explorer.tsx",
    "sha256": "df892c2e544a59e343fa4870bcb0c5114c15f245821963c7ee3883553e5adbf2",
    "reason": "Clears pending readback and reports result-unknown or applied-but-unverified."
  },
  {
    "path": "src/dashboard/surfaces/intake-upload-model.ts",
    "sha256": "7ff3485b9ded9a222395ae9edd38b936c5d508b7699328d01825865f96567930",
    "reason": "Clears pending work and publishes failed with unknown/not-sent delivery."
  },
  {
    "path": "src/dashboard/surfaces/settings-editor-model.ts",
    "sha256": "f386c403c7a6ba4ad01fbab6f72b4dfe36d917f9da02e4d7defde27cea719429",
    "reason": "Before-effect refusal clears the attempt; unconfirmed writes retain it. The refresh callback already publishes read failure before rejecting."
  },
  {
    "path": "src/dashboard/surfaces/settings-protected-model.ts",
    "sha256": "1edd66a777f13b0e9e04128b4e2d56b0a8e0ffc983c25c289aea2980f11861d1",
    "reason": "Only a before-effect refusal clears the attempt; unconfirmed credential writes retain it."
  },
  {
    "path": "src/backend/storage/sqlite/explorer-override-conversion.ts",
    "sha256": "bb9d4706dd3430b8850a8859d94f2dc64f0fe61bd7da8d9aa2c8acbf1ae3b108",
    "reason": "P2 path-only relocation/import update; ENOENT alone denotes an absent optional legacy file; all other errors propagate."
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "sha256": "50fe30ff5cfe9d0e4e08fa17556780b834c089927b7f67337a011ddfb4b77064",
    "reason": "P2 path-only relocation/import update; ENOENT alone denotes no backup directory; failed inspection sets an explicit invalid health flag."
  },
  {
    "path": "src/backend/storage/sqlite/storage-recovery-status.ts",
    "sha256": "cec91793472773d8d9b8f5728511070983268d597d065b9d672d320967f6fa1b",
    "reason": "P2 path-only relocation/import update; ENOENT alone proves absent archive; all other errors propagate to unavailable custody."
  },
  {
    "path": "src/backend/app/composition/dashboard/notification-health.ts",
    "sha256": "0c607f7146d081cb7e713bc7358ab8fe06b42a00ea153229a9444db8dd5fb340",
    "reason": "P2 path-only relocation/import update; Failure booleans trigger explicit failed health notifications; they never claim a healthy read."
  },
  {
    "path": "src/dashboard/app/archive-route-model.ts",
    "sha256": "8fef5678863b376426604d70548de944bc6ef98f7e1992ed0064ceab764305b1",
    "reason": "Invalid user route JSON returns null; its caller marks the route invalid and blocks Archive exports."
  },
  {
    "path": "src/dashboard/ds/primitives-date.tsx",
    "sha256": "55ecca0c630c38a073862a18bdcb1e8820bc2ddaf3c4aca62681f5deae6351ff",
    "reason": "Invalid editable dates remain invalid without substitution; supplied invalid bounds throw a named error."
  },
  {
    "path": "src/dashboard/surfaces/activity.tsx",
    "sha256": "f65b0cb14ae881523b0a99b2bdb0e138a62016e1c2bb5daa80157e33b34b6618",
    "reason": "Invalid date drafts cannot establish a selection; range validation refuses applying them."
  },
  {
    "path": "src/dashboard/surfaces/settings-provider-model.ts",
    "sha256": "f75f2a9e0007a3a58d33602ee99195b88b7350f075372d68e383f37428390bb0",
    "reason": "Typed before-effect refusals clear only the attempt; unknown writes retain exact attempts and drafts and publish unconfirmed."
  },
  {
    "path": "src/dashboard/surfaces/settings-relocation-model.ts",
    "sha256": "0061184f72016650aa856f414410157d1eeab3fcd2d12a61537f885563c63ac8",
    "reason": "Typed before-effect refusal clears only the attempt; unknown writes retain it and publish unconfirmed; unavailable reads lock editing."
  },
  {
    "path": "src/models/dashboard/activity-volume.ts",
    "sha256": "e86030a210690c7f06ee550063b628ac9f113a2321d1e02a16b70aa8e17b25a0",
    "reason": "Invalid IANA zones fail the validation predicate; public callers reject with named errors without substituting a zone."
  },
  {
    "path": "src/backend/storage/configuration/provider-key-store.ts",
    "sha256": "75c9c451e23634d5e0d313850876d4c552e00a0a1ecf4d6a9181d7680abad7a5",
    "reason": "P2 path-only relocation/import update; Only ENOENT denotes optional metadata or stage absence; managed history and pending state require exact custody, and other failures throw unknown."
  },
  {
    "path": "src/backend/storage/admission/installation.ts",
    "sha256": "1e48c429623d4fb00334435c5a7e3ff10afbac67d42cd833b98e7bf4c628d39b",
    "reason": "P2 path-only relocation/import update; Only ENOENT denotes path absence; callers validate exact optional-path contracts or refuse missing required entries; other errors propagate."
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
    "reason": "P2 path-only relocation/import update; Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/backend/runtime/workers/worker-supervisor.ts",
    "sha256": "9de7e351cbd83a7bf780acb7560bd14e2bc4cc85c928294139f71e9ed84fa4c2",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
  },
  {
    "path": "src/backend/storage/maintenance/relocation-inventory.ts",
    "sha256": "279739ef891e91b39cf660757de46e7666b12430adcc810e637e48d005798bd5",
    "reason": "P2 path-only relocation/import update; A failed binding rejects that candidate; absence of any verified matching backup throws an unbound preserved-copy error."
  }
] as const;
