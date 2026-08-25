# Dashboard

Dashboard surfaces are component-only `.tsx` modules. Keep hooks, folds, vocabulary maps and value
formatters in the matching `*-model.ts` sibling so Fast Refresh remains a leaf boundary. Import design
atoms from `ds/ui.tsx`; do not fork local visual vocabularies.

## Logs

The Logs tab renders the strict lazy `LogRowWire` union. `observed` rows alone carry a resolved system,
directions and redacted value facts; `transaction-fenced` is an authority beat and must never borrow any
of those observation fields. Keep server `sequence` order, append only immutable cursor pages, and group
only contiguous rows by their real producer. Notes stay notes.

### Dated lessons

- **2026-08-25 — a fence is not a page observation.** A producer's task system resolves the origin of
  an observed row, but a durable `transaction.fenced` beat is not an observed read or write. Rendering
  its producer system, a direction arrow, or a placeholder pill would turn authority timing into false
  page evidence; leave those details absent. (D270 / observed-logs)
