# Interrupted intake images — not accepted parity references

These two PNGs were inherited untracked under
`tests/parity/archive-evidence.spec.ts-snapshots/`. Parent visually inspected both: the image was
broken even though the caption claimed verified retained bytes. They are preserved here as intake
evidence, not deleted, not accepted screenshots, and not loaded by the parity configuration.

Moved byte-for-byte after first-pass review; original empty snapshot directory removed. Active
parity uses `tests/parity/references/` triplets and must be deliberately regenerated and reviewed.

| File | Unchanged SHA-256 |
| --- | --- |
| `archive-evidence--graphite-warm--1280x720-darwin.png` | `b02cb4260ce632be81ea0c2c81f6ffb8ad38f0eca07a7539204aaf617599dc33` |
| `archive-evidence--paper-ink--phone-390x844-darwin.png` | `9f4283369844d0af97cff87519ceda0c6edc0def9bdae6ac491f83ee92b452a8` |

Before any allocated reference update, all four inherited a11y/meta files were also preserved
byte-for-byte under `reference-originals/`. They are interrupted provenance, not accepted proof:

| Original reference | SHA-256 |
| --- | --- |
| `archive-evidence--graphite-warm--1280x720.a11y.yml` | `a68e7077c64edf8642af6bebaf38da8485854a01bebe6ce001468c41eaf8c5c7` |
| `archive-evidence--graphite-warm--1280x720.meta.json` | `c9f7c4d5f4d00ac261fe8025369603f9c75dd6eaa5a9da0e81f3415a607c7e69` |
| `archive-evidence--paper-ink--phone-390x844.a11y.yml` | `13ead454b4e80db587015ed444164b5a2a197d22e7abc750b40bd31e9e13f6a5` |
| `archive-evidence--paper-ink--phone-390x844.meta.json` | `469e7558722db7ef27ddccc7773df09e08eec1e324940d3ade2f4507aeb51c7e` |
