/** Exact integrated sources reviewed under the 3.1.12 guard-only amendment.
 * Any byte change requires re-review; new code and direct negative controls remain unexcepted. */
export const REVIEWED_CATCH_DEFAULTS = [
  {
    "path": "src/dashboard/surfaces/notifications/notification-delivery.ts",
    "sha256": "118c34b858d14dfea3a8e9e48afd02862e8113a32e9f3e86125b6ebb33eff17e",
    "reason": "Clears lock ownership and publishes delivery-failed; no success state is invented."
  },
  {
    "path": "src/dashboard/surfaces/explorer/explorer.tsx",
    "sha256": "23771c01e6570bdf0d4844722ebc5971041fc1ee8733d57aff8ed9d2bed3c6d7",
    "reason": "Clears pending readback and reports result-unknown or applied-but-unverified."
  },
  {
    "path": "src/dashboard/surfaces/intake/intake-upload-model.ts",
    "sha256": "7ff3485b9ded9a222395ae9edd38b936c5d508b7699328d01825865f96567930",
    "reason": "Clears pending work and publishes failed with unknown/not-sent delivery."
  },
  {
    "path": "src/dashboard/surfaces/settings/editor/settings-editor-model.ts",
    "sha256": "8b19800870a11d05b92454989c756103cf81b4ed65aab2b5100ae88259e4a794",
    "reason": "Before-effect refusal clears the attempt; unconfirmed writes retain it. The refresh callback already publishes read failure before rejecting."
  },
  {
    "path": "src/dashboard/surfaces/settings/providers/settings-protected-model.ts",
    "sha256": "aefae8492ebcbe6cdab6837ade1445910956b3cd66b2093cb3504e188337d9bd",
    "reason": "Only a before-effect refusal clears the attempt; unconfirmed credential writes retain it."
  },
  {
    "path": "src/infra/sqlite/explorer-override-conversion.ts",
    "sha256": "23df9ce2ea42330ad8cecaae3e56eb40535a1877d636dfb24ed1aeb5b8d21264",
    "reason": "ENOENT alone denotes an absent optional legacy file; all other errors propagate."
  },
  {
    "path": "src/infra/sqlite/storage-doctor.ts",
    "sha256": "ec5b2e71363a043fa88bc798f28ac14ef708bf5e80efabcf650d30baa0d8e2e8",
    "reason": "ENOENT alone denotes no backup directory; failed inspection sets an explicit invalid health flag."
  },
  {
    "path": "src/infra/sqlite/storage-recovery-status.ts",
    "sha256": "0b0bc37b337df932e1021baa78920bfe8970b6b49e2e67088773831d2348b3f3",
    "reason": "ENOENT alone proves absent archive; all other errors propagate to unavailable custody."
  },
  {
    "path": "src/server/dashboard/compose/notification-health.ts",
    "sha256": "d07dd3f5dbae66383f251c4514ab8c3a369c52d9a2081015a00b7bb451693ce7",
    "reason": "Failure booleans trigger explicit failed health notifications; they never claim a healthy read."
  }
] as const;
