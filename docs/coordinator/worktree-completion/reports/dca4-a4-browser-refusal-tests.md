# DCA4 A4 — browser refusal oracle review

Native `sup_luna_dca4_a4_http_tests_review`, high reasoning, independent read-only Tests axis.
Target HEAD `eda17b27` and only `tests/parity/archive-evidence.spec.ts`, SHA-256
`7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0`, verified unchanged.
Reviewer closed after return; no writer/test/browser authority.

**Count 2; worst medium. Both accepted, repair pending.**

1. `archive-evidence.spec.ts:295` — Installing the rejecting `decode` override does not prove
   execution. Shared failure-title, hidden-image and absent-success assertions also pass when image
   loading fails first, as the initial gate demonstrated. Require an invocation marker/counter and
   positive natural dimensions before accepting this named refusal; retain all current UI checks.
2. `archive-evidence.spec.ts:281` — Registering the exact image HTTP abort does not prove the handler
   ran. Require exact-request interception and its failed-request event after the injected abort;
   retain the existing UI assertions. An unrelated image-load error must not satisfy this scenario.

This review concerns only the two refusal-test oracles, not the moving HTTP-adapter repair. It adds
two findings to the previous raw Tests history rather than replacing earlier counts. Browser proof
and red controls remain subject to explicit allocation; no prior five-pass claim proves fault reach.

## Independent repaired-delta receive

New spec `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1`; exact
incremental patch and source receipt in `dca4-a3-browser-oracles.md`. Parent verified hash after
closing writer. No runtime/fixture/PNG/reference changes in this unit.

| Independent axis | Native role | Count / worst | Disposition |
| --- | --- | --- | --- |
| Tests | sup_luna | 0 open / none | Both original medium findings structurally closed; inside-decoder marker/natural dimensions and exact intercepted/aborted/failed Request identity independently verified |
| Correctness | sup_terra | 0 / none | Closed; event listener/capture precede abort, same Request identity and exact fault asserted, decoder installed before release, no new race or unhandled promise identified |
| Standards | sup_luna | 0 / none | Closed; reconstructed exact before hash and +39/−3 patch identity, case-local observations/cleanup, no unsafe assertions, unchanged eleven cases and existing bounds |

Tests reviewer matched spec and aggregate before/after, verified all prior UI assertions and finally
cleanup remain. This is source-level closure only: browser and both negative controls remain pending
allocation. Other full-feature axes need no repeated pass for this test-only strengthening; no product
contract, documentation, runtime performance, serving authority or security behavior changed.
