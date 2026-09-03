# R2 u07 — base and domain unit inventory

## Owned ledger

The baseline owns 16 files and 312 tests. Each file exercises a public pure-function or strict-schema
boundary; none is assertion-free, tautological, or mock theater.

| Family | Files | Cases | Distinct failure protected |
| --- | --- | ---: | --- |
| canonical identity and primitives | `canonical-fields`, `domain-primitives`, `normalization-rules`, `sha256`, `trust-records` | 43 | invalid identity/date/hash/trust shapes are rejected rather than normalized into plausible data |
| configuration and secrets | `config`, `secrets-redaction` | 77 | resolver precedence, atomic settings behavior, and credential/value redaction fail loud |
| intake and OCR | `intake-header-discovery`, `intake-mapping`, `intake-validation`, `ocr-extraction-admission`, `ocr-stack`, `roster-match` | 132 | ambiguous headers/people, stale mappings, rejected cells, and incomplete documents cannot become accepted input |
| timecard and separation dates | `separation-timecard`, `timecard-period` | 55 | distinct public parsers reject rollover dates and preserve calendar/range semantics |
| advisory redaction | `advisory-redaction` | 5 | provider prompts and outputs cannot expose classified values |

All paths are under `tests/unit/` and end in `.test.ts`. Case counts are the collected baseline:
`advisory-redaction` 5, `canonical-fields` 17, `config` 47, `domain-primitives` 6,
`intake-header-discovery` 10, `intake-mapping` 30, `intake-validation` 30,
`normalization-rules` 13, `ocr-extraction-admission` 23, `ocr-stack` 14, `roster-match` 25,
`secrets-redaction` 30, `separation-timecard` 22, `sha256` 3, `timecard-period` 33, and
`trust-records` 4.

## Disposition

- Retain every case. The similarly named date refusals exercise different public parsers and formats.
- Keep `config.test.ts` physically intact in R2. Its settings-persistence cases are storage concerns,
  but splitting this mixed file is final-taxonomy work for R7, not a reason to duplicate or delete it.
- R3 residue is the browser/session/Duo/provider/preflight/UCPath/Kronos driver family. R4 owns
  dashboard wire/model and Explorer UI protocol tests. R5 owns scenario and live-dry-run authority.

## Proof

The final explicit 82-file R2 run measured and passed this family's 16/16 files and 312/312
expanded cases. No source or test behavior changed in u07.
