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
    "sha256": "64465834420c5b27cf40bb21161743acfce2e216b0576c1d6ac3d89cbedcc2df",
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
    "path": "src/infra/sqlite/explorer-override-conversion.ts",
    "sha256": "23df9ce2ea42330ad8cecaae3e56eb40535a1877d636dfb24ed1aeb5b8d21264",
    "reason": "ENOENT alone denotes an absent optional legacy file; all other errors propagate."
  },
  {
    "path": "src/infra/sqlite/storage-doctor.ts",
    "sha256": "265943eddf435d61d0bddd475023403bb7e5a5f025dfc0012b90638da3555527",
    "reason": "ENOENT alone denotes no backup directory; failed inspection sets an explicit invalid health flag."
  },
  {
    "path": "src/infra/sqlite/storage-recovery-status.ts",
    "sha256": "361e137e127fd421eba62d38e8072a09e87c7c5dfe7e4b6614f321c2c165cc81",
    "reason": "ENOENT alone proves absent archive; all other errors propagate to unavailable custody."
  },
  {
    "path": "src/server/dashboard/compose/notification-health.ts",
    "sha256": "675ace61532eb186fb40f045fcd0aa698e2c9740f4dda43015cbe494454526ef",
    "reason": "Failure booleans trigger explicit failed health notifications; they never claim a healthy read."
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
    "path": "src/infra/config/provider-key-store.ts",
    "sha256": "ddbcc6c212d7b1bde91f0e4fd49ea00bc6b9abe57c805a1498d7e24bc7d31e27",
    "reason": "Only ENOENT denotes optional metadata or stage absence; managed history and pending state require exact custody, and other failures throw unknown."
  },
  {
    "path": "src/infra/runtime-control/installation.ts",
    "sha256": "b973ba434dfe263d4130aa0c8de3cfd663d36cc1138dc54015dc34c98f391c06",
    "reason": "Only ENOENT denotes path absence; callers validate exact optional-path contracts or refuse missing required entries; other errors propagate."
  },
  {
    "path": "src/server/dashboard/commands/ordinary-path-validator.ts",
    "sha256": "2c668f8490e2ff5919d5d0a8fa929997b53981f401fad6633fb33c3c164aeaf8",
    "reason": "Only an explicitly allowed missing directory with ENOENT returns false; safe parent validation follows, and other errors throw named refusal."
  },
  {
    "path": "src/server/dashboard/native-path-picker.ts",
    "sha256": "aad965c7e8ccde6756e238ef63835a9a307a68441393559c87783040ba343f6d",
    "reason": "Invalid or unavailable selected paths become explicit dialog-failed responses; cancellation has its own exact marker."
  },
  {
    "path": "src/server/dashboard/queries/item-attempt-history.ts",
    "sha256": "9d30441f20ce1d2e1aa93adb46efd3043f5ba75099af1a6490d05cc458f45521",
    "reason": "Malformed supplied cursors become explicit refusal before authority reads; omitted cursors remain distinct valid first-page requests."
  },
  {
    "path": "src/server/dashboard/worker-supervisor.ts",
    "sha256": "252cde3ad225bee11b4358ea91c659e5f8202841c413f96b87a86cb53a1d5855",
    "reason": "The rejection observer does not replace the original drain promise; shutdown races that promise and throws aggregate failure."
  },
  {
    "path": "src/server/storage/relocation-inventory.ts",
    "sha256": "12cfef319cccfc2464fe26470610911535469af40d46f8cce6f134f9067985d7",
    "reason": "A failed binding rejects that candidate; absence of any verified matching backup throws an unbound preserved-copy error."
  }
] as const;
