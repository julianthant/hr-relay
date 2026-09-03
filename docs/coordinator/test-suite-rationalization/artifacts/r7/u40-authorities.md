# R7 u40 — canonical authority reconciliation

One logical commit, `5d1909fc`, ratifies the operator's 2026-09-02 decisions without creating a new
decision id:

| Authority | Reconciliation |
|---|---|
| `docs/rebuild/reference/guards-and-tests.md` | Current 81/70/9/2 guard census, 306/70/17 project census, three-project exact-once topology, 17-spec/281-case/222-triple parity census, risk-based retention rule, sole verbose stream, stable phase policy, and non-waiving runtime targets |
| `docs/rebuild/reference/frontend-backend-integration.md` §7.1/§7.4 | Current parity census and executable structural performance ceilings; 5,569 is tied to D269's intentional pool read without rewriting the historical 5,568 measurement |
| `docs/rebuild/reference/decisions.md` | D191 pointer amended to the current disjoint self-contained superset, targeted conveniences, retention/output policy, and performance owner |
| `docs/rebuild/guard-inventory.json` | `gate-coverage` and `guard-manifest` invariants now describe the exact enforced command/project/reporter contract |
| root `AGENTS.md` + `CLAUDE.md` | Byte-identical broadened self-contained-gate rule, three-project commands, and dated retention/output/performance lesson |
| scenario `AGENTS.md` + `CLAUDE.md` | Inspected and deliberately unchanged: the existing map already states the three scenario kinds and current paths; both files remain byte-identical |

The root owner states that all finished lint/type/test/architecture/parity/performance/smoke/Duo and
generated gates are self-contained. Frozen authenticated legacy provenance remains permitted as
repository data; runtime resolution of the legacy checkout does not.

Focused proof before the authority commit: typecheck passed; the two affected architecture files
passed 12/12 with labeled output; lint completed with zero emitted diagnostics; `git diff --check`
and root twin comparison passed. Full exit proof belongs to u42.
