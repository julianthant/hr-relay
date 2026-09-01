# DCA4 A4 — HTTP adapter delta review

Target HEAD `eda17b27`; UI aggregate `2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0`.
Exact three-file before/after hashes and red/green evidence: `dca4-a3-http-repair.md`.
The browser-oracle writer owns only the separate spec; these three paths stay frozen.
Parent matched all three hashes and reran both focused files: **18 passed, 4.71s, 08:17:11 PDT**.

| Independent axis | Native role | Count / worst | Disposition |
| --- | --- | --- | --- |
| Correctness | sup_terra | 0 / none | Closed; anchored route preserves scenario/exact-ID refusal, API/SSE/query/response behavior and neighboring static paths |
| Silent failures | sup_terra | 0 / none | Closed; exact route returns Hono refusal without static fallback; existing status/header/body forwarding unchanged |
| Tests | sup_luna | 0 / none | Closed; literal byte/digest/header checks, static collisions, scenario isolation, neighboring routes and owned finally cleanup; negative-control logs independently read |
| Standards | sup_luna | 0 / none | Closed; reconstructed before-hashes prove bounded delta; exact routing, owned HTTP test cleanup, explicit non-rendered probe justification and lesson comply |
| Docs | sup_luna | 0 / none | Closed; new dated lesson accurately reflects real HTTP red, exact-route repair and both negative controls |
| Security | sup_sol | 0 / none | Closed; exact-ID/scenario handler remains authoritative, every Hono response returns before static serving, no additional byte source or broader egress |

Spec re-review is unnecessary for this delta: no product contract or behavior changed; this restores
the declared fixture route. Performance re-review is unnecessary for a bounded anchored route match
with unchanged serving/streaming, not a render/collection/authority path. No simplification pass is
requested. Previous full-feature reviews remain historical; actual browser acceptance is pending.
