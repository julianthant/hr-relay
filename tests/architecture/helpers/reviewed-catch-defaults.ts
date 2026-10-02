/** Exact source classifications: every byte change requires re-review.
 * New code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/dashboard/state/notification-delivery.ts",
    "sha256": "118c34b858d14dfea3a8e9e48afd02862e8113a32e9f3e86125b6ebb33eff17e",
    "reason": "Clears lock ownership and publishes delivery-failed; no success state is invented."
  },
  {
    "path": "src/dashboard/surfaces/explorer.tsx",
    "sha256": "c716ccbc285a031488b68ec5e2b9faff4263e07d3b4dc0de13ffadf8464f168b",
    "reason": "Clears pending readback and reports result-unknown or applied-but-unverified."
  },
  {
    "path": "src/dashboard/surfaces/intake-upload-model.ts",
    "sha256": "7ff3485b9ded9a222395ae9edd38b936c5d508b7699328d01825865f96567930",
    "reason": "Clears pending work and publishes failed with unknown/not-sent delivery."
  },
  {
    "path": "src/dashboard/surfaces/settings-editor-model.ts",
    "sha256": "5c972a402e476d9419ee990f414ff8783527a274b33634f085556c97b6b4ef55",
    "reason": "Before-effect refusal clears the attempt; unconfirmed writes retain it. The refresh callback already publishes read failure before rejecting."
  },
  {
    "path": "src/dashboard/surfaces/settings-protected-model.ts",
    "sha256": "85b9859d03aecc1710180390e0f1a0835cf4fab625e1b03768a0f5e8a086fbc6",
    "reason": "Only a before-effect refusal clears the attempt; unconfirmed credential writes retain it."
  },
  {
    "path": "src/backend/storage/sqlite/explorer-override-conversion.ts",
    "sha256": "eafb91300b8c6d48f196d2e5d47e6dd812a4632c5682044c41548f7545801808",
    "reason": "P2 path-only relocation/import update; ENOENT alone denotes an absent optional legacy file; all other errors propagate."
  },
  {
    "path": "src/backend/storage/sqlite/storage-doctor.ts",
    "sha256": "98822cf362946611c38ceda77cf5836cecbefba39f61d11c4a11170a3292cf7d",
    "reason": "P2 path-only relocation/import update; ENOENT alone denotes no backup directory; failed inspection sets an explicit invalid health flag."
  },
  {
    "path": "src/backend/storage/sqlite/storage-recovery-status.ts",
    "sha256": "880020f5256f2670b16d3a464b807ef7f36ebdc175b829683ba03fffc590491b",
    "reason": "P2 path-only relocation/import update; ENOENT alone proves absent archive; all other errors propagate to unavailable custody."
  },
  {
    "path": "src/backend/app/dashboard/compose/notification-health.ts",
    "sha256": "15adc467978d1dd20f7df810076b4ccebf310e36d137fc9f04c6241e73d0037d",
    "reason": "P2 path-only relocation/import update; Failure booleans trigger explicit failed health notifications; they never claim a healthy read."
  },
  {
    "path": "src/dashboard/app/archive-route-model.ts",
    "sha256": "badb2391227a3df1c97776538388ed210b316b00c91d519a66c27028d9c07090",
    "reason": "Invalid user route JSON returns null; its caller marks the route invalid and blocks Archive exports."
  },
  {
    "path": "src/dashboard/ds/primitives-date.tsx",
    "sha256": "55ecca0c630c38a073862a18bdcb1e8820bc2ddaf3c4aca62681f5deae6351ff",
    "reason": "Invalid editable dates remain invalid without substitution; supplied invalid bounds throw a named error."
  },
  {
    "path": "src/dashboard/surfaces/activity.tsx",
    "sha256": "72309282ffe00d6a0b5a200f9367cad30659ade0794338a3a0beaf8c877f41e0",
    "reason": "Invalid date drafts cannot establish a selection; range validation refuses applying them."
  },
  {
    "path": "src/dashboard/surfaces/settings-provider-model.ts",
    "sha256": "c3bad8ec46e5e072977a32eaf408360b5f80bfb911b34f3f0776b82fe0453aba",
    "reason": "Typed before-effect refusals clear only the attempt; unknown writes retain exact attempts and drafts and publish unconfirmed."
  },
  {
    "path": "src/dashboard/surfaces/settings-relocation-model.ts",
    "sha256": "927fc4a75a6eabb9df8604dd538b7a9703e2a086a2a48c344256b787338810c0",
    "reason": "Typed before-effect refusal clears only the attempt; unknown writes retain it and publish unconfirmed; unavailable reads lock editing."
  },
  {
    "path": "src/domain/dashboard/activity-volume.ts",
    "sha256": "7d8620edfd2e66a2916ea6452b46163a3fb8fde300b490c7f25ad3b2f045cebd",
    "reason": "Invalid IANA zones fail the validation predicate; public callers reject with named errors without substituting a zone."
  },
  {
    "path": "src/backend/storage/config/provider-key-store.ts",
    "sha256": "3aa46e746475ba0a488a545ea14e0b278d99a1773dbc8561873da5b3a26dd882",
    "reason": "P2 path-only relocation/import update; Only ENOENT denotes optional metadata or stage absence; managed history and pending state require exact custody, and other failures throw unknown."
  },
  {
    "path": "src/backend/storage/admission/installation.ts",
    "sha256": "09a4a30274c4f732027eeb2560c17a1a01ce288fe551eafd975117c718b76971",
    "reason": "P2 path-only relocation/import update; Only ENOENT denotes path absence; callers validate exact optional-path contracts or refuse missing required entries; other errors propagate."
  },
  {
    "path": "src/backend/runs/dashboard/commands/ordinary-path-validator.ts",
    "sha256": "7ff254da9813cc19716c099793d8cbfe8219c68c4fe679bdf7ea1236e1328c59",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal."
  },
  {
    "path": "src/backend/transports/dashboard/native-path-picker.ts",
    "sha256": "007eb3ef33b948ddcb5a0d328ccae182400321699118a44023f635740774abb7",
    "reason": "Invalid or unavailable selected paths become explicit dialog-failed responses; cancellation has its own exact marker."
  },
  {
    "path": "src/backend/runs/dashboard/queries/item-attempt-history.ts",
    "sha256": "4d6c3d771922f81f30e291f272d6d3e460cb9930a5b8b3a39fed529b022878d5",
    "reason": "P2 path-only relocation/import update; Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/backend/runtime/dashboard/worker-supervisor.ts",
    "sha256": "4fa75207f0d1583416a9a8d00257132b24eab15a5edf225e7e1e27b3f0161545",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
  },
  {
    "path": "src/backend/storage/storage/relocation-inventory.ts",
    "sha256": "30271c318f7c1ccf488ff16923fd4c833e6de3c5537689da32faff15cd65635b",
    "reason": "P2 path-only relocation/import update; A failed binding rejects that candidate; absence of any verified matching backup throws an unbound preserved-copy error."
  }
] as const;
