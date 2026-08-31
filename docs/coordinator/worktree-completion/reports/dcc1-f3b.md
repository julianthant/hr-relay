# DCC1 F3b — raw symlink-target parent traversal

STATUS: done for the assigned seam; red/green/restored mutation and focused/full locked gates passed; owned paths staged. Parent retains final integrated acceptance.
ROLE: sup_sol_dcc1_f3b_symlink_target. MODEL: gpt-5.6-sol (dispatch). REASONING: high.
COMMITS: none; active parent merge preserved. SCOUTS: none.

## Intake and scope

Every command/edit used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`, MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Verified staged tree `1295cd01e6abc5a9e802f10d63980e7264cd6233`, zero unmerged entries.
Existing parent changes in reports dcc1-m2, dcc1-review-candidate, dcc1 and untracked dcc1-m4 were left alone, as were all staged F2b tests and earlier F1/F2/F3 work.
Parent released the sole light slot only after its F2b composition gate completed 28/28, exit 0; no F3b gate started before release.

Only settings-file.ts, config.test.ts, nearest AGENTS.md and this report are owned. No agents/worktrees/commits, foreign operations, live authority, HR action, migrations, D75 or heavy gates.

| File | Intake blob |
| --- | --- |
| src/infra/config/settings-file.ts | 77ec857996cf4fab8b5d7f6470f4b52a769255a8 |
| tests/unit/config.test.ts | cb5bf0e9c8c125fa766b5c4896b223059f6b4094 |
| AGENTS.md | 66ebe36d465bd4915d2bafef31ea8b6ba15c31a0 |

## Bounded fix and real-topology proof

One raw target read plus a whole-component check: refuse `rawTarget.split("/").includes("..")` before passing the target to `resolve`. This does not add a physical resolver or change other trust rules. Existing ordinary root-owned /var and /tmp targets remain valid. The error names the directory and the forbidden raw parent component.

The public `createSettingsFileAuthority(...).read()` regression builds real temporary topology:

```text
system/alias -> pivot/../safe
system/pivot -> foreign/sub
system/safe                 (lexically verified destination)
foreign/                   (mode 0777)
  sub/
  safe/settings.json        (actual destination; private exact baseline bytes)
```

Only lstat's uid observation for system, alias and pivot is simulated as root-owned, so the existing application-symlink refusal cannot mask the defect. No real chown or root privilege is used. Real modes, inode identities, symlink bytes, kernel path traversal and file effects are untouched. The test confirms it inspected the simulated root-owned alias and checks the specific new raw-component error.

Native realpath establishes the physical destination. The first attempted fixture assertion used Node's JavaScript realpathSync, which returned the lexical destination on this host; that setup failure is recorded below and is NOT counted as the product red. Switching the test oracle to realpathSync.native exposed the actual system traversal. Old code then published settings.json.authority.json under foreign/safe. This is an observable unsafe effect, not an existing application-link refusal.

With the guard, directory entry inventories and exact pre-existing settings bytes remain unchanged, the lexical destination stays empty, and foreign's 0777 mode stays unchanged. Removing ONLY the new guard reproduces the same unwanted sidecar. Restoring it returns green. Source blob before/after mutation is exactly `5f8f8faf035d22a1e47c8ae838aadf26cb00463f`; test blob is `b61ca7b3133b1fffb30423f68049017a6491a186` both times (chunks 9a31ab / 8ccd47).

This demonstrates a conditional root-owned-alias topology; it makes no claim that this host has a deployed unsafe Settings alias. The existing local POSIX mode/sticky trust assumptions remain unchanged. No ACL inspection, root/same-UID adversary guarantee or broader authority mechanism was added. Whole '..' path components refuse, not ordinary filenames merely containing two dots.

## Gates

All four focused single-test invocations below used the same exact command:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses raw parent traversal in a system symlink target' --reporter=dot
```

| Gate | Result |
| --- | --- |
| Old-code regression | exit 1; unwanted physical authority sidecar; chunk db40f4 |
| Fix regression | exit 0; 1 passed / 43 skipped; chunk 88d1c8 |
| Remove raw-target guard | exit 1; same unwanted physical authority sidecar; chunk 12b96e |
| Restored config + settings-file-service | exit 0; 2 files / 54 tests passed; 6.57s; chunk 619fa8 |
| Locked full typecheck | exit 0; `tsc --noEmit`, no diagnostics; chunks f2740f / f2faed |
| Locked full lint | exit 0; `eslint src tests scripts --max-warnings 0`, no diagnostics; chunks 6d3611 / 96bac2 |

Restored suite command:

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts tests/unit/settings-file-service.test.ts --reporter=dot
```

The restored suites include existing safe 0755, sticky-ancestor and root-owned system-alias tests. No pre-existing test assertion, timeout or threshold changed.

Full gate invocations:

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

Both commands finished; all test processes and synchronous crash-test children finished. Sole light-gate admission returns to the parent. No foreign process was touched. `git diff --check` passed. Mutation/debug-tag search returned no matches (chunk 8ff117).

| Final payload file | Gated/staged blob |
| --- | --- |
| src/infra/config/settings-file.ts | 5f8f8faf035d22a1e47c8ae838aadf26cb00463f |
| tests/unit/config.test.ts | b61ca7b3133b1fffb30423f68049017a6491a186 |
| AGENTS.md | d3aeff2ae20e45c54afdd89b03cfe1e46a393716 |

After staging exactly these three payload paths, before adding this report, the index tree was
`b8776af06b18d4bfa0de4e4bb0175dc17d30ddd3` (chunk 51ec06). The non-owned sorted index listing
SHA-256 stayed `8e866698d4996cd6bd7665c758637ce65e62d704c1995820bd3a492cfda566c6` before/after staging.
Final report blob and index tree including this report are returned in the final summary to avoid
self-reference. Parent reports remain unchanged by F3b; no commit was made. Parent retains final
integrated acceptance and independent review.

## Detailed focused outputs

### Fixture-oracle correction (not the product red)

Exit 1; chunk `327e08`.

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

----x---------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses raw parent traversal in a system symlink target before touching its physical destination
AssertionError: Expected values to be strictly equal:
+ actual - expected

+ '/private/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/hrauto-settings-symlink-parent-AVP4W1/system/safe'
- '/private/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/hrauto-settings-symlink-parent-AVP4W1/foreign/safe'


Expected: "/private/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/hrauto-settings-symlink-parent-AVP4W1/foreign/safe"
Received: "/private/var/folders/pt/fjkm2v7952902hpx0jcdxfnh0000gn/T/hrauto-settings-symlink-parent-AVP4W1/system/safe"

 ❯ tests/unit/config.test.ts:308:14
    306|       symlinkSync("pivot/../safe", alias);
    307|       chmodSync(foreign, 0o777);
    308|       assert.equal(realpathSync(alias), physicalSafe);
       |              ^
    309|       assert.notEqual(realpathSync(alias), lexicalSafe);
    310|       const record = SettingsFileRecordSchema.parse({

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 43 skipped (44)
   Start at  08:02:49
   Duration  458ms (transform 226ms, setup 0ms, import 357ms, tests 9ms, environment 0ms)
```

### Old-code defect red

Exit 1; chunk `db40f4`.

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

----x---------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses raw parent traversal in a system symlink target before touching its physical destination
AssertionError: unsafe alias must not publish authority evidence at its physical destination
+ actual - expected

  [
    'settings.json',
+   'settings.json.authority.json'
  ]


- Expected
+ Received

  [
    "settings.json",
+   "settings.json.authority.json",
  ]

 ❯ tests/unit/config.test.ts:343:14
    341|       }
    342|       assert.equal(inspectedRootAlias, true, "must pass the simulated …
    343|       assert.deepEqual(readdirSync(physicalSafe), entries,
       |              ^
    344|         "unsafe alias must not publish authority evidence at its physi…
    345|       assert.deepEqual(readFileSync(join(physicalSafe, "settings.json"…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 43 skipped (44)
   Start at  08:02:57
   Duration  408ms (transform 181ms, setup 0ms, import 281ms, tests 41ms, environment 0ms)
```

### Minimal-fix green

Exit 0; chunk `88d1c8`.

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

----·---------------------------------------

 Test Files  1 passed (1)
      Tests  1 passed | 43 skipped (44)
   Start at  08:03:12
   Duration  408ms (transform 209ms, setup 0ms, import 324ms, tests 6ms, environment 0ms)
```

### Guard-removal mutation red

Exit 1; chunk `12b96e`.

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

----x---------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses raw parent traversal in a system symlink target before touching its physical destination
AssertionError: unsafe alias must not publish authority evidence at its physical destination
+ actual - expected

  [
    'settings.json',
+   'settings.json.authority.json'
  ]


- Expected
+ Received

  [
    "settings.json",
+   "settings.json.authority.json",
  ]

 ❯ tests/unit/config.test.ts:343:14
    341|       }
    342|       assert.equal(inspectedRootAlias, true, "must pass the simulated …
    343|       assert.deepEqual(readdirSync(physicalSafe), entries,
       |              ^
    344|         "unsafe alias must not publish authority evidence at its physi…
    345|       assert.deepEqual(readFileSync(join(physicalSafe, "settings.json"…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 43 skipped (44)
   Start at  08:03:33
   Duration  397ms (transform 165ms, setup 0ms, import 261ms, tests 55ms, environment 0ms)
```
