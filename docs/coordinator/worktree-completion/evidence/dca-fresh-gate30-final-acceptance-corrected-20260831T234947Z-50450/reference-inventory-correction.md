# Gate 30 reference inventory correction

The retained `reference-inventory-before.tsv` was copied from refresh 28 post-refresh evidence,
which predates Repair29. Its narrow Receipt pair therefore showed the superseded hashes
`d9bfdd11e15f73e2445c4658a781dab7757534f586dfdff7448c08f87aaa4e8c` (a11y) and
`3e3f8c70ac43700af3752e792eba86f539f94866c9a3b4935da813e29a37973c` (PNG). This is a
baseline-methodology error, not a gate-30 mutation.

Repair29 is the authoritative pre-gate-30 receipt. It corrected the pair to:

- `run-receipt--paper-ink--narrow-1024x768.a11y.yml` —
  `da1a953fa356f44ef61fb2437b57711804b160ccee482c60f5ca3d529d8e0dd4`
- `run-receipt--paper-ink--narrow-1024x768.png` —
  `2d8cf4f5b1558b5cd1b19f05796218a1972b44c7fae760731cac6484841d5f89`

Gate 30’s after inventory contains those exact hashes, and the complete 591-file after inventory
matches Repair29’s corrected reviewed state. The 80 tracked deltas and 12 untracked feature refs
remain unchanged. No reference file was edited by this correction.
