# Mobile document capture retirement inventory

Verified 2026-08-31 against `master` before destructive edits. This inventory implements DCT1 from
`docs/plans/2026-08-28-dashboard-completion-runs.md` and fixes the overloaded word *capture* before
the product is removed.

## Delete: the phone document-capture product

- Browser entry and UI: `src/dashboard/capture.html`, `src/dashboard/phone/`, the operator Start
  Capture and capture-session surfaces, their polling state, client methods, Vite entry, phone
  parity cases, fixtures and references.
- Transport and composition: the two operator capture endpoints, the closed phone route union,
  phone Host gate, capture token/ingress handling, capture service and capture composition.
- Product authority: capture commands, capture session/finalization schemas and repositories,
  phone-photo facts, PDF finalization, capture-to-intake handoff and workflow capture bindings.
- Configuration and readiness: capture configuration leaves, capture-only environment overrides,
  `feature.capture`, `capture.ingress`, its preflight row, and capture-only capability declarations.
- Storage: append a new migration that drops the retired `capture_sessions`,
  `capture_photo_order`, and `capture_finalization_outboxes` tables. Released migration bytes remain
  immutable; fresh and admitted existing databases reach the retired shape through the append-only
  suffix.
- Active authorities: remove every current roadmap, phase, reference and finding promise that could
  schedule phone capture again. Historical records stay historical.

## Keep: evidence capture

- Diagnostic screenshot capture and failure bundles under `src/domain/trust/` and
  `src/services/trust/`.
- Run-detail Capture tiles, their verified artifact-byte route, and Receipt presentation.
- Archive capture records, multi-origin tiles, verified Archive resource routes and downloads.
- Generic artifact storage/readers and non-phone OCR/intake upload workflows.
- Frozen historical documents that describe the feature as past work; current authorities must name
  the retirement when those records are still referenced.

## Proof boundary

The close must prove that no `/capture.html`, `/api/v1/capture/*`, Start Capture control, phone
bundle, capture command family, capture configuration, capture-session authority repository, or
active phone-capture plan remains. It must also keep diagnostic-bundle, run-capture and Archive
evidence tests green.
