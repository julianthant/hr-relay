# DCA joined receipt-frame repair

Status: complete; no staging, commit, merge, cleanup, push, browser, or parity run was performed.

## Delivered

- Literal `failure` capture tile and preview frames now select the existing solid
  `--ds-danger` token locally; ordinary frames retain `--ds-border`.
- The public DashboardApp DOM test was made red first against the old translucent class, then
  green after the one-line model repair.
- The seven-case parity spec now expects visible `Done`, absolute artifact hrefs rooted at
  `server.baseUrl`, and its rendered helper binds the exact solid token, unequal ordinary token,
  and at-least-3 painted contrast in both exercised themes.
- `src/dashboard/AGENTS.md` records the local D291/DCA4 lesson without changing shared DS tokens
  or contrast thresholds.

## Evidence

| Check | Result | Raw log |
| --- | --- | --- |
| Public DOM red | 2 expected assertion failures / 36 passing | `evidence/dca-joined-receipt-frame-repair-red.log` |
| Public DOM green | 38 passing | `evidence/dca-joined-receipt-frame-repair-public-green.log` |
| Focused capture units | 42 passing | `evidence/dca-joined-receipt-frame-repair-focused-green.log` |
| Locked typecheck | passed | `evidence/dca-joined-receipt-frame-repair-typecheck.log` |
| Locked lint | passed | `evidence/dca-joined-receipt-frame-repair-lint.log` |

Every Vitest command used `VITEST_MAX_WORKERS=1` and
`HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`. Typecheck and lint used the
global light gate lock independently. Browser/parity work remains for the owning integration
lane; the preserved intake red is `evidence/dca-joined-receipt-parity-03.log`.

Writer/light ownership released.

## State-bound provenance after independent review closure

- Base HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index empty.
- Complete changed non-coordination set: 89 paths.
- Aggregate recipe: locale-sort every changed tracked/untracked non-coordination path; hash each
  row as `path + NUL + SHA256(file)`; join rows with LF; SHA-256 the joined bytes.
- Aggregate: `29fb7bff021957c7b86fba9cb75ef4928b3a7e18423a57d3946ab10a87010144`.
- Repair source/test/lesson hashes: `run-captures-model.ts` `8215e2c2…98e1`;
  `run-captures-app.test.ts` `7933b52b…11bf`; `run-captures.spec.ts` `2fd584f3…97a2`;
  `src/dashboard/AGENTS.md` `575dac82…2b0`.

The Tests review requested an explicit status oracle. The bounded closure observes the response
caused by the same exact absolute-URL native-download click, requires exact GET and status 200,
then retains the byte-length/SHA-256 download proof; it issues no second fetch. Standards corrected
the lesson's owner citation to D292. The optional Graphite preview interaction was explicitly not
added: shared frame-function unit proof, Paper preview and Graphite tile are the approved bounded
coverage. Post-repair browser proof remains pending a fresh heavy allocation.

The state-bound parent receipt `evidence/dca-joined-receipt-frame-parent-gates-02.json` binds this
exact aggregate and four path hashes to the three fresh raw logs and their SHA-256 values. Parent
focused proof is 42/42; locked typecheck and lint exited 0.
