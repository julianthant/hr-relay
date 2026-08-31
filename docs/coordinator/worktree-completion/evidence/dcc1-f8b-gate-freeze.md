# DCC1 F8b — renewed frozen gate candidate

2026-08-30. Parent receive complete; **requesting coordinator readiness verification/allocation, not claiming an OPEN slot**. No F8b full coverage/parity pass or product commit.

## Exact identity and nontracked inputs

Assigned workdir: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
First parent / HEAD: `0c115123a738f62cbe01c9b45f53b7289284479c`.
Ordered second parent / MERGE_HEAD: `13175b13340fec7b5326207fe54f98078d481d7d`.
Complete frozen index: **`ae00723e05d20a6c87d0ada500fc77a456870ea9`**.
Execution closure: **`d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051`**.

Only two parent reports differ from packaging-review tree5372550b: main `dcc1.md` and new
`dcc1-packaging-reviews.md`. No execution input differs from F8b reviewed source or its parent
focused/typecheck/lint checks. No unstaged tracked changes or unresolved entries.
There are exactly40 untouched original plaintext evidence files, enumerated with sizes/hashes in
`dcc1-packaging-inventory.json`, intentionally untracked non-execution outputs. This freeze and
`../handoffs/2026-08-30-dcc1-f8b-frozen-gate-queue.md` are the two subsequently created untracked
recovery outputs (42 total). The only ignored input is node_modules/.

The originals must remain until full gates and independent verification that committed archives
and manifest are durable. After that, only exact-original movement to a verified already-ignored
task-specific destination is authorized; no deletion, ignore edit or assumed test-results exclusion.
No destination has been chosen and no original moved. Existing recovery handoffs remain open.

## Source and gate proof

F8b review target0b5→99d464d2: all eight independently persisted code axes Count0 in
[code receive](../reports/dcc1-f8b-reviews.md). Parent18205 passed78/78 focused plus independently
locked typecheck/lint. Parent20355 freshness passed BEFORE raw evidence staging.
All ten meaningful retained mutation red/restored pairs are preserved; the unmatched prior filter
and fixture setup failures retain their actual distinct results. F7c historical mutation objects
remain explicitly receive-reconstructed, not originally retained.

The original frozen0b5 full coverage87688 remains RED (334passed/1failed files,
3786passed/1failed tests,310.16s,gate1/logger0). Its raw original SHA256
`6db1a56603ad76aa3b859445e315a76ee2b1701bbb23ac72d5b573dd6de311e8` is unchanged after lossless
archival. Parity was withheld, and no coverage-floor/suite-size pass was reported.

Packaging targetcc9d→5372550b: Standards/Spec/Docs each Count0; exact parent receipt and chronology
are in [packaging receive](../reports/dcc1-packaging-reviews.md). All40 archives verified against
original bytes, staged blobs, hashes, deterministic recompression and zero timestamp/name headers;
35 retained metadata pairs unchanged. Parent135-link check (97 archive links) passed at537.
The oldcc9d staged check exit2/52diagnostics and new packaged check exit0 remain distinct.
Worker report's indexcc9d/pending staging is its historical return boundary, not this final state.

Parent final receive chunk9e5ff6 exited0: exact40 originals retained/untracked, no other untracked
input at capture, all40 archive bytes equal staged blobs and decoded originals, no unstaged/unmerged,
both diff checks0, execution closure exact; dependencies below freshly repinned. This is read-only
metadata verification, not a product-gate rerun or a disk-first raw test stream.
All native units and own command sessions are closed/completed.

## Complete dependency / subtree capture

Observed values from final parent verification; legacy reads are guard metadata only, not live data.
No dependency installation, .env/.auth/state/bundle/profile provisioning, source change or
reference update occurred. The absent paths are absence facts, not authorization to provision them.

```json
{
  "index": "ae00723e05d20a6c87d0ada500fc77a456870ea9",
  "head": "0c115123a738f62cbe01c9b45f53b7289284479c",
  "mergeHead": "13175b13340fec7b5326207fe54f98078d481d7d",
  "branch": "feature/r-dcc-dcc1-exclusive",
  "closure": "d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051",
  "untrackedOriginals": 40,
  "ignored": "node_modules/",
  "manifestSha256": "a42a2661b798ea2dd3f44cc2b4d2e266d2d5aa787830887e6f7c26882fa1bb2a",
  "node": "v26.1.0",
  "npm": "11.13.0",
  "macOS": "26.5.2",
  "graphSha256": "3d0dc25a77748026d1d6d56a127245cdc89499a81ccb3e48b60140fe444f74df",
  "files": {
    "node_modules/.package-lock.json": "7748ec1b028a665a821e3e718be6d637dc15aa881701cb4c7fecf435e4e8074a",
    "node_modules/playwright-core/browsers.json": "ee39bc924bc3d1bd895626c2910f1292d109bbfeeb5abd113acb45e1951cc942",
    "/Users/julianhein/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell": "11e393326c7d20a7c56641a7c65def33ea9c280da3b0b74cf8563b07989a0ee3"
  },
  "trees": {
    "src": "a4311225ee6cdd6a0b79f3cdf3f6187a0766fd53",
    "tests": "730c7b6f4bc7921393bc603930e693d7fda00b28",
    "config": "bb97f70db688e07cdfcc9995890f574274031b98",
    "scripts": "be8b9264a6e8c48ae3d1573f490e11f0a92743a8",
    "docs/rebuild": "ae76371bccc96e5deacaa6c9873d600e57c180ed",
    "docs/roadmap": "075dab18c9f3245a0ff5a04d04c8b6f4e9edfc31",
    "tests/parity/references": "2821164f92b32c11ab39acdd9dddb6064f4ce9d1"
  },
  "blobs": {
    "src/server/settings-runtime.ts": "f0746f5f649d5c0bcea055852b9d3345d72c45e5",
    "tests/unit/server/compose-real-port.test.ts": "7edb5c38b5fb112c8ced91a2895d225349a4e644",
    "AGENTS.md": "28a672ae2317d66acb058e4df0fe9163de2410f4",
    "tests/unit/architecture/control-command-single-path.test.ts": "dc10fa414fc60b4f0115ae943cef9f58919bd8b0",
    "src/server/dry-run-scenario/runtime.ts": "ec2933b2587eee5359abd0c7d7b44952ff9d38de",
    "tests/unit/dry-run-scenario-composition.test.ts": "e373f7677f9afdc56bbea12cf75487760ed85cf5",
    "package-lock.json": "ee52d301c65cb2938eb41f4decd0d3cb50383ab1"
  },
  "absent": {
    ".env": true,
    ".auth": true,
    ".tracker-rebuild": true,
    "dist": true
  },
  "legacyHead": "9d19e4141d57617e2bf895e21e34a5bd8f15047c",
  "legacyDirty": "M config/rebuild/legacy-change-accounting.json\n M config/rebuild/legacy-preservation.json\n M tests/unit/systems/ucpath/selectors.test.ts",
  "legacyFiles": {
    "config/rebuild/legacy-change-accounting.json": "418e0f44ea4aa56f9849d3e392f3f0aef60f40111d52c5ff305c6415faafa93c",
    "config/rebuild/legacy-preservation.json": "e26deafbd20eba9e697df4068c0e1b2ec55de286e530898d36f6fe54dedf2a6a",
    "tests/unit/systems/ucpath/selectors.test.ts": "217deb94a06516e3b12844b1e6380a702fa9b093f6a10577714228fe642d5f54"
  },
  "finalDiffChecks": {
    "cached": 0,
    "unstaged": 0
  }
}
```

Reproduce the tracked closure without dropping any execution/config/reference/AGENTS/root tooling:

```sh
set -o pipefail
git ls-tree -r --full-tree ae00723e05d20a6c87d0ada500fc77a456870ea9 | rg -v $'\tdocs/coordinator/worktree-completion/(reports|evidence|handoffs)/' | shasum -a 256
```

Observed SHA256 is `d681c0c5a4d7e2764d40f231e1f5f3650a838b044264a5a37077235de1f18051`. Only coordination reports/evidence/handoffs are excluded.
Installed graph pin is the SHA256 of complete `npm ls --all --json` stdout with exit0;
other dependency pins are SHA256 of named bytes. Legacy HEAD and its exact three dirty guard files
remain unchanged; no live state was read.

## Queue and full-gate contract

Reuse SAME native Sol/high240k/220k gate unit `01a052fa-e2fc-7a32-81d0-23814d305b56`.
Do not start any gate/probe/build/browser because an OS lock looks free. Only explicit coordinator
OPEN permits each following heavy command, separately, from the assigned workdir:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:parity
```

No own concurrent light gate. Retain exact process bytes to an exclusive disk file before tool
transport and separately persist real gate/logger exits/timestamps. Preserve existing asserted
reference/buildstamp behavior; PARITY_UPDATE unset, no threshold/timeout/assertion changes.
Healthy full command finishes naturally; any red stops parity/repair/commit. Send immediate app
terminal release when OS lock is actually released, BEFORE packaging/manual UI/polish.
Rendered parity judgment uses /ui after required skill/reference reads.

Full gates precede product commit. Bind committed full executable closure to this tested identity;
new commit hash alone does not require duplicate full gates when inputs remain identical.
A meaningful input change invalidates affected proof and requires review/reallocation.
Any new gate-output archival requires an explicitly inventoried non-overwrite packaging treatment;
the existing40-path grant is not a blanket normalization or cleanup permission.

Migration history collisions/deployment uncertainty and D75 final-join residue remain open under
coordinator/operator authority. Shared integration/03b and removal of this assigned worktree remain
coordinator-owned; never root/master integration, push, live workflow or history rewrite.
