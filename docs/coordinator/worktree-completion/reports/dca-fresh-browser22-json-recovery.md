# DCA fresh browser22 JSON recovery receipt

Date: 2026-08-31 PDT  
Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Status: **green; one locked browser execution only**

## Command and lock

Exact command (with stdout/stderr mechanically redirected to the preserved raw log):

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/diagnostic-bundle-dialog.spec.ts --grep 'captures the exact-identity screenshot gallery with attributable fixture metadata'
```

- Exit: `0`; the terminal raw log says `1 passed (5.2s)` using one worker.
- `PARITY_UPDATE` was unset by the command's `env -u PARITY_UPDATE`; no update-mode command ran.
- The top-level `lockf` command ended naturally with the test process, so its advisory lock was released. No retry or second browser command ran.

## Preserved evidence

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `evidence/dca-fresh-browser22-parity.log` | 591 | `5cab77010e73e696a7893b9659ce48a7627c7bcd859d1e0276862d988c7990d6` |
| `evidence/dca-fresh-browser22-results.json` | 6,337 | `564f43a8f7443d61456f2bdfeb228fcdc701befcca7a80f4ec386c9663d90b82` |

The copied JSON has stats `expected=1, skipped=0, unexpected=0, flaky=0`. The selected test is `expectedStatus=passed`, test status `expected`, with exactly one retry-0 result status `passed`, no singular error, and an empty errors array.

Declared required evidence: `diagnostic-lightbox--graphite-warm--1280x720.a11y.yml`. Its JSON attachment body is present (`text/yaml`, 912 base64 characters), decodes to 682 bytes of valid UTF-8, and has SHA-256 `84126fddae629341f545259a748a9ab4ccdace8f385d5bee366dcf4e86fa6fe0`. Its `a11y-attachment-sha256:` annotation declares the identical digest.

Output inventory (four files): `.last-run.json` (45 bytes, `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`); the lightbox PNG and its attachment copy (each 148,159 bytes, `c113aea439d12bffb8e39edecde87642b0d5d0df089333d5d9615f7cd830d6a9`); and `results.json` as above.

## Reference integrity

The six `diagnostic-bundle-gallery` reference files had byte-identical before/after SHA-256 values:

- graphite a11y `616556cdf8fb902c55b3f0d32239cc53e7cd67cd79cbbcf6fa6513aa6ba575da`; metadata `10bc39c3ec9bb2cb3a680fe01b79f7bb530e1683f545c0ce54f70ec9b2d2a079`; PNG `d034a6f5a1beff86427e9cea0d0a71047b465a0c37775ef1bde3dcd0a18bcb4f`.
- paper a11y `4bad33ef5c397c78adb1170f08cfef9ff3d42ca503919c61dc35dd9e491b40ad`; metadata `e9b5c21daefb06c0d4e65da416c69e63b9f9bd60f47a4b2fba4f6c13735f91c2`; PNG `3a46a8b1fa1bac0024dc68eaddfd65ee85c89f0e4b07ee1523491addb3b61bad`.

`git status --short tests/parity/references` remained the same pre-existing untracked set before and after. No reference, source, test, package, or configuration file was edited; no staging or commit occurred.
