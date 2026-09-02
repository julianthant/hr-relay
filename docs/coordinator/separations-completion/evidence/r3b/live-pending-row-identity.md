# R3b live pending-row identity mapping

Date: 2026-09-02. Read-only `playwright-cli` session: `r3b-map`. The session daemon artifact closed at 2026-09-02T10:33:05-0700. No checkbox, command button, gate, write, deletion, registry entry or environment value was changed. This record deliberately omits every employee name, EID and transaction-ID value.

## Observed surfaces

The UCPath **Transactions in Progress** grid exposed one rendered row. Its row and checkbox DOM suffixes were positional, so they were rejected as identity. The row exposed six named data controls, using these live prefixes:

| Field | Live DOM control prefix |
|---|---|
| Transaction Type | `TBH_TMPL_TXN_TYP$` |
| Effective Date | `EFFDT$` |
| Name | `NAME$` |
| Person ID | `EMPLID$` |
| Action | `ACTION$` |
| Country | `COUNTRY$` |

The row container prefix was `trHR_TBH_EULST_VW$0_row`; the checkbox prefix was `SELECT$`. These locate the current row and control but do not identify a transaction.

The EID-filtered **SS Smart HR** search returned five stable transaction identifiers. Each result's detail page was opened read-only through the `UC_TRANSACT_ID` query and independently checked against the detail page's displayed transaction ID. Exactly one result was an in-progress termination. The other four were protected rows.

## Proved join

The one in-progress detail row joined uniquely to the one Transactions in Progress grid row on the facts shared by both surfaces:

- exact EID;
- normalized exact displayed name;
- exact effective/start date; and
- the shared termination-action classification (`TER` on detail versus `Terminatn` on the grid).

Transaction Type and Country are only exposed by the grid. The implementation requires each named control to be unique and nonempty, retains both values in staging evidence, and does not use either as cross-surface identity. No position, row suffix or checkbox suffix participates in the permanent key.

This proves a stable seam: the SS Smart HR detail transaction ID is permanent row identity, while the complete unique shared-fact join authorizes association with the separate deletion checkbox. Missing, duplicate, moved, newly appeared or differently joined rows refuse before selection. The real driver then re-reads the stable-ID source immediately before selection.

`playwright-cli close` completed for `r3b-map`; the final `playwright-cli close-all` / `playwright-cli list` sweep reports no browsers.
