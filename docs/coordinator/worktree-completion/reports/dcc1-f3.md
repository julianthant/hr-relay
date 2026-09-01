# DCC1 F3 — Settings filesystem directory integrity

STATUS: done for the assigned seam; 12 mutation proofs detected, restored focused/full gates passed, owned paths staged. Parent merge/integrated acceptance remains parent-owned.
ROLE: sup_sol_dcc1_f3_directory_integrity. MODEL: gpt-5.6-sol (dispatch). REASONING: high.
COMMITS: none; explicit dispatch preserves the active parent merge for supervisor commit.
SCOUTS: none. No child agents, new worktree, live authority, HR action, migration, D75, push, reset or cleanup of foreign resources.

## Verified source and scope

All commands/edits used `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.
Branch `feature/r-dcc-dcc1-exclusive`; HEAD `0c115123a738f62cbe01c9b45f53b7289284479c`;
MERGE_HEAD `13175b13340fec7b5326207fe54f98078d481d7d`.
Intake index tree `e1f092841a8f79c1c9d3329e79407e253e062f95`; no unmerged entries.
Parent explicitly staged its six existing doc corrections, command-kernel import fix and reports during this unit; observed parent tree before F3 staging `27d6208fa0ab06b71c78fbd659d8435f2fecb3cd`.
Those staged/unstaged parent reports and all existing F1/F2/merge work remain untouched by F3.

| Owned file | Intake blob |
| --- | --- |
| src/infra/config/settings-file.ts | 2b34d99a3a20a38b4879316a589d902aa15f2678 |
| tests/unit/config.test.ts | 5dd41481665a4891804dedf5b1c4aab913faa47e |
| AGENTS.md (nearest existing owner) | 7474548f0004a23b4f5f138bf501a8cec72decac |

The additionally authorized settings-file-service test required no edit: its existing pre-replace regression proved sensitive.

## Invariant and OS assumptions

Before acquiring the Settings lock, walk the full existing directory ancestry from root, checking owner and mode before creating missing components one at a time. The authority parent is runtime-owned and excludes group/world write. Ancestors must be root/runtime-owned; group/world writable ancestors require sticky semantics and their child must still have a trusted owner. Thus safe 0755 parents and ordinary sticky temporary roots remain valid; a sticky authority directory itself is refused.

Application symlinks refuse. Root-owned system symlinks under root-owned parents (observed macOS /tmp and /var) are permitted only after walking their target ancestry too. Every path's device/inode is bound for the authority instance and rechecked on admission, file operations and settlement. Missing/replaced bound directories refuse without recreation, chmod or evidence cleanup. Raw lock recovery/cleanup paths also recheck after hooks.

This assumes a local POSIX filesystem with normal mode/sticky enforcement, trusted root and runtime UID, and no ACL grants that broaden write access. It is NOT an arbitrary ACL audit, privileged-mount defense, or same-UID/root adversary proof. The tests simulate path replacement to prove deterministic identity refusal; they do not claim race-proof exclusion of the directory owner.

## Red → green

The exact first red, before production edits (2026-08-30 07:48:20 local):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses a writable settings parent' --reporter=dot
```

Exit 1, chunk `38ff4b`: `AssertionError: Missing expected exception.`; 1 failed / 37 skipped. Same command after the directory protocol: exit 0, chunk `881b59`, 1 passed / 37 skipped.

Expanded focused suites: 52/52 passed (chunk `adcc80`); with foreign-owner refusal, 53/53 passed (chunk `42b630`). After all mutations were restored: 53/53 passed (chunk `d1ca5c`). No assertion, timeout or threshold was removed/weakened.

New regression coverage: parent modes 0770/0707/0777/01777; unsafe ancestors at read/reconcile/withExactRecord/apply and missing descendants; no callback effects and unchanged real settings/prepare/lock/initialization bytes; unchanged permissions; legitimate owned 0755 under sticky ancestors; root-owned OS aliases; application symlink refusal; foreign UID observation; bound-directory rename/replacement/deletion preserving prepared evidence during read/commit/rollback.

Byte-boundary readback now strictly parses the persisted envelope, compares the exact actor label, command and revision, then compares public authority readback. The same-size mutant retains exactly 1,048,576 bytes and a valid record yet fails the independent actor assertion. Old-broad-hash and missing-lastApplied fixtures are independent: the broad-hash case now has otherwise complete lastApplied evidence. Four DCC3 leaves also round-trip through the real file authority.

## Mutation evidence

All mutations affected only settings-file.ts, sequentially, and were restored with exact inverse patches before the next. Production blob before/after the 12 mutants: `77ec857996cf4fab8b5d7f6470f4b52a769255a8`. Test blob during proofs: `0c80fe71b7202ed1590df59742b02da9f55a7757`; subsequent test-only typing repair reads the fixture owner's uid from lstat instead of invoking optional process.getuid directly.

| # | Deliberate defect | Exit | Test result |
| --- | --- | --- | --- |
| 1 | parent/ancestor mode check | 1 | 2 failed | 41 skipped (43) |
| 2 | bound pathname identity | 1 | 1 failed | 42 skipped (43) |
| 3 | same-size wrong actor label | 1 | 1 failed | 42 skipped (43) |
| 4 | implicit old-schema conversion | 1 | 1 failed | 42 skipped (43) |
| 5 | fabricated missing lastApplied | 1 | 1 failed | 42 skipped (43) |
| 6 | drop DCC3 ocr?.pageConcurrency | 1 | 1 failed | 42 skipped (43) |
| 7 | drop DCC3 ocr?.maxValidationRetries | 1 | 1 failed | 42 skipped (43) |
| 8 | drop DCC3 concurrency?.defaultWorkers | 1 | 1 failed | 42 skipped (43) |
| 9 | drop DCC3 paths?.reportsDir | 1 | 1 failed | 42 skipped (43) |
| 10 | removed pre-replace exact-byte guard | 1 | 1 failed | 9 skipped (10) |
| 11 | directory owner check | 1 | 1 failed | 42 skipped (43) |
| 12 | application symlink refusal | 1 | 1 failed | 42 skipped (43) |

M1 disables the mode refusal; M2 disables bound inode comparison; M3 substitutes b for a at identical actor length. M4 normalizes only an old persisted schema/hash pair; M5 fabricates only missing lastApplied evidence. M6–M9 independently delete each DCC3 leaf after merge, proving persistence (not just schema admission). M10 removes only the existing pre-replace exact-byte guard. M11 disables directory ownership refusal; M12 disables application-symlink refusal. All 12 red results name the missing behavior, not compilation failures.

## Full gates and remaining close

First locked typecheck passed before the final owner test. Fresh typecheck found `TS2722/TS18048` at config.test.ts:293 (optional process.getuid). Fixed by reading the real mkdtemp directory owner with lstat; no production change, assertion weakening or fallback. Fresh focused/full gates required after that fix.

Final gate commands all ran in the assigned worktree, one owned light process at a time:

| Gate | Exact command | Exit / evidence |
| --- | --- | --- |
| Restored focused suites after typing repair | `env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts tests/unit/settings-file-service.test.ts --reporter=dot` | 0; 2 files, 53 tests passed; 6.97s; chunk `fcb7b4` |
| Full typecheck | `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck` | 0; `tsc --noEmit`, no diagnostics; chunks `4782e0` / `3cd9d6` |
| Full lint | `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` | 0; `eslint src tests scripts --max-warnings 0`, no diagnostics; chunks `bd9ce1` / `70e143` |
| Diff integrity | `git diff --check` and `git diff --cached --check` | 0; chunk `65de71` |
| Temporary-mutation cleanup | `rg -n 'Temporary mutation|\[DEBUG-|&& false|false &&' src/infra/config/settings-file.ts tests/unit/config.test.ts` | 1 = no matches; chunk `92d512` |

All owned execution sessions and synchronous crash-test children finished. No resource remains running; no foreign process was killed. Gate admission returns to the parent with this report.

| Final payload path | Gated/staged blob |
| --- | --- |
| src/infra/config/settings-file.ts | 77ec857996cf4fab8b5d7f6470f4b52a769255a8 |
| tests/unit/config.test.ts | cb5bf0e9c8c125fa766b5c4896b223059f6b4094 |
| AGENTS.md | 66ebe36d465bd4915d2bafef31ea8b6ba15c31a0 |

Payload index tree after staging exactly these three paths, before adding this report:
`ff80f5bb1e13ada2a47dcb79d013ae4eea25e388` (chunk `2b4145`).
The sorted non-owned index listing SHA-256 remained exactly
`6710f18acb680c23197b3a90369e9b2924b580439f81ce1637185397192e4eb8`
before/after staging. The final index tree including this report is returned in the final summary, avoiding a self-referential report hash.

Heavy coverage/parity is not allocated; parent owns integrated gates and independent review. Owning ref clock-config-secrets §3 still calls directory integrity open; it is outside this seam's authorized edit paths, so the parent should reconcile that paragraph after accepting this report. No board writes.

## Detailed mutation gate log

### M1 — parent/ancestor mode check

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses a writable settings parent|refuses unsafe ancestors' --reporter=dot
```

Exit 1, tool chunk fd8898:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

xx-----------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses a writable settings parent before touching authority evidence
AssertionError: Missing expected exception.

simple

 ❯ tests/unit/config.test.ts:181:16
    179|       for (const mode of [0o770, 0o707, 0o777, 0o1777]) {
    180|         chmodSync(root, mode);
    181|         assert.throws(() => authority.read(), /settings directory.*gro…
       |                ^
    182|         assert.deepEqual(readdirSync(root), entries);
    183|         assert.deepEqual(entries.map((entry) => readFileSync(join(root…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses unsafe ancestors at every settings entry point without creating missing descendants
AssertionError: The input did not match the regular expression /settings directory.*group\/world-writable/u. Input:

'Error: exclusive settings authority is held by live pid 19821 (acquisition e6457827-a468-4e87-8f5f-5498289d7370)'


- Expected:
/settings directory.*group\/world-writable/u

+ Received:
Error {
  "message": "exclusive settings authority is held by live pid 19821 (acquisition e6457827-a468-4e87-8f5f-5498289d7370)",
}

 ❯ tests/unit/config.test.ts:222:16
    220|         });
    221|         const refusal = /settings directory.*group\/world-writable/u;
    222|         assert.throws(() => authority.read(), refusal);
       |                ^
    223|         assert.throws(() => authority.reconcile(() => { effects += 1; …
    224|         assert.throws(() => authority.withExactRecord({

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 41 skipped (43)
   Start at  07:52:28
   Duration  588ms (transform 221ms, setup 0ms, import 333ms, tests 151ms, environment 0ms)
```

### M2 — bound pathname identity

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses a redirected bound directory' --reporter=dot
```

Exit 1, tool chunk 2e081e:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-----x-------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses a redirected bound directory before reading or settling through its replacement
AssertionError: Missing expected exception.

simple

 ❯ tests/unit/config.test.ts:322:14
    320|       mkdirSync(directory, { mode: 0o700 });
    321|
    322|       assert.throws(() => authority.read(), /settings directory.*chang…
       |              ^
    323|       assert.throws(() => applied.commit(), /settings directory.*chang…
    324|       assert.throws(() => applied.rollback(), /settings directory.*cha…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:29
   Duration  426ms (transform 178ms, setup 0ms, import 268ms, tests 81ms, environment 0ms)
```

### M3 — same-size wrong actor label

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'persists actor metadata whose canonical settings file is exactly' --reporter=dot
```

Exit 1, tool chunk a1da30:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

--------------x----------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > persists actor metadata whose canonical settings file is exactly the byte maximum
AssertionError: exact-boundary actor label must round-trip without substitution

- Expected
+ Received

- true
+ false

 ❯ tests/unit/config.test.ts:605:14
    603|       assert.equal(parsed.revision, 2);
    604|       assert.equal(parsed.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    605|       assert.ok(parsed.settings.actor?.label === "a".repeat(1_048_000),
       |              ^
    606|         "exact-boundary actor label must round-trip without substituti…
    607|       assert.equal(parsed.lastApplied?.commandId, SETTINGS_COMMAND_1);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:30
   Duration  573ms (transform 228ms, setup 0ms, import 344ms, tests 140ms, environment 0ms)
```

### M4 — implicit old-schema conversion

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses old broad-schema and missing-lastApplied' --reporter=dot
```

Exit 1, tool chunk 113e79:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-------x-----------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses old broad-schema and missing-lastApplied envelopes without converting bytes
AssertionError: Missing expected exception.

simple

 ❯ tests/unit/config.test.ts:386:16
    384|         writeFileSync(path, bytes, { mode: 0o600 });
    385|         const authority = createSettingsFileAuthority({ path });
    386|         assert.throws(() => authority.read(), /strict persisted settin…
       |                ^
    387|         assert.equal(readFileSync(path, "utf8"), bytes);
    388|         assert.equal(existsSync(`${path}.prepare.json`), false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:51
   Duration  469ms (transform 207ms, setup 0ms, import 321ms, tests 57ms, environment 0ms)
```

### M5 — fabricated missing lastApplied

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses old broad-schema and missing-lastApplied' --reporter=dot
```

Exit 1, tool chunk 007cbe:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-------x-----------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses old broad-schema and missing-lastApplied envelopes without converting bytes
AssertionError: Missing expected exception.

simple

 ❯ tests/unit/config.test.ts:386:16
    384|         writeFileSync(path, bytes, { mode: 0o600 });
    385|         const authority = createSettingsFileAuthority({ path });
    386|         assert.throws(() => authority.read(), /strict persisted settin…
       |                ^
    387|         assert.equal(readFileSync(path, "utf8"), bytes);
    388|         assert.equal(existsSync(`${path}.prepare.json`), false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:52
   Duration  430ms (transform 200ms, setup 0ms, import 295ms, tests 53ms, environment 0ms)
```

### M6 — drop DCC3 ocr?.pageConcurrency

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'admits exactly the four DCC3 leaves' --reporter=dot
```

Exit 1, tool chunk e3fd37:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------x------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > admits exactly the four DCC3 leaves alongside the retained backend arms
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected
... Skipped lines

  {
    browser: {
      headless: false
    },
    concurrency: {
...
      maxValidationRetries: 0,
-     pageConcurrency: 3
    },
    paths: {
      reportsDir: '/tmp/reviewed-reports'
    }
  }


- Expected
+ Received

@@ -5,11 +5,10 @@
    "concurrency": {
      "defaultWorkers": 2,
    },
    "ocr": {
      "maxValidationRetries": 0,
-     "pageConcurrency": 3,
    },
    "paths": {
      "reportsDir": "/tmp/reviewed-reports",
    },
  }

 ❯ tests/unit/config.test.ts:361:14
    359|       if (applied.state !== "applied") assert.fail("DCC3 leaves must a…
    360|       applied.commit();
    361|       assert.deepEqual(authority.read().settings, patch);
       |              ^
    362|     } finally {
    363|       rmSync(root, { recursive: true, force: true });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:53
   Duration  439ms (transform 191ms, setup 0ms, import 282ms, tests 80ms, environment 0ms)
```

### M7 — drop DCC3 ocr?.maxValidationRetries

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'admits exactly the four DCC3 leaves' --reporter=dot
```

Exit 1, tool chunk 5d7335:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------x------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > admits exactly the four DCC3 leaves alongside the retained backend arms
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected
... Skipped lines

  {
    browser: {
      headless: false
    },
    concurrency: {
...
    ocr: {
-     maxValidationRetries: 0,
      pageConcurrency: 3
    },
    paths: {
      reportsDir: '/tmp/reviewed-reports'
    }


- Expected
+ Received

@@ -4,11 +4,10 @@
    },
    "concurrency": {
      "defaultWorkers": 2,
    },
    "ocr": {
-     "maxValidationRetries": 0,
      "pageConcurrency": 3,
    },
    "paths": {
      "reportsDir": "/tmp/reviewed-reports",
    },

 ❯ tests/unit/config.test.ts:361:14
    359|       if (applied.state !== "applied") assert.fail("DCC3 leaves must a…
    360|       applied.commit();
    361|       assert.deepEqual(authority.read().settings, patch);
       |              ^
    362|     } finally {
    363|       rmSync(root, { recursive: true, force: true });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:54
   Duration  447ms (transform 173ms, setup 0ms, import 265ms, tests 98ms, environment 0ms)
```

### M8 — drop DCC3 concurrency?.defaultWorkers

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'admits exactly the four DCC3 leaves' --reporter=dot
```

Exit 1, tool chunk cf70b9:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------x------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > admits exactly the four DCC3 leaves alongside the retained backend arms
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected

  {
    browser: {
      headless: false
    },
+   concurrency: {},
-   concurrency: {
-     defaultWorkers: 2
-   },
    ocr: {
      maxValidationRetries: 0,
      pageConcurrency: 3
    },
    paths: {


- Expected
+ Received

@@ -1,12 +1,10 @@
  {
    "browser": {
      "headless": false,
    },
-   "concurrency": {
-     "defaultWorkers": 2,
-   },
+   "concurrency": {},
    "ocr": {
      "maxValidationRetries": 0,
      "pageConcurrency": 3,
    },
    "paths": {

 ❯ tests/unit/config.test.ts:361:14
    359|       if (applied.state !== "applied") assert.fail("DCC3 leaves must a…
    360|       applied.commit();
    361|       assert.deepEqual(authority.read().settings, patch);
       |              ^
    362|     } finally {
    363|       rmSync(root, { recursive: true, force: true });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:55
   Duration  437ms (transform 187ms, setup 0ms, import 278ms, tests 82ms, environment 0ms)
```

### M9 — drop DCC3 paths?.reportsDir

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'admits exactly the four DCC3 leaves' --reporter=dot
```

Exit 1, tool chunk a4a653:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

------x------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > admits exactly the four DCC3 leaves alongside the retained backend arms
AssertionError: Expected values to be strictly deep-equal:
+ actual - expected
... Skipped lines

  {
    browser: {
      headless: false
    },
    concurrency: {
...
    },
+   paths: {}
-   paths: {
-     reportsDir: '/tmp/reviewed-reports'
-   }
  }


- Expected
+ Received

@@ -7,9 +7,7 @@
    },
    "ocr": {
      "maxValidationRetries": 0,
      "pageConcurrency": 3,
    },
-   "paths": {
-     "reportsDir": "/tmp/reviewed-reports",
-   },
+   "paths": {},
  }

 ❯ tests/unit/config.test.ts:361:14

    359|       if (applied.state !== "applied") assert.fail("DCC3 leaves must a…
    360|       applied.commit();
    361|       assert.deepEqual(authority.read().settings, patch);
       |              ^
    362|     } finally {
    363|       rmSync(root, { recursive: true, force: true });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:52:56
   Duration  575ms (transform 263ms, setup 0ms, import 389ms, tests 97ms, environment 0ms)
```

### M10 — removed pre-replace exact-byte guard

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/settings-file-service.test.ts -t 'refuses to overwrite live bytes that change while a complete patch is staging' --reporter=dot
```

Exit 1, tool chunk 3d41da:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

-------x--

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/settings-file-service.test.ts > baseline atomic Settings invariants on the single file authority > refuses to overwrite live bytes that change while a complete patch is staging
AssertionError: Missing expected exception.

simple

 ❯ tests/unit/settings-file-service.test.ts:195:12
    193|     });
    194|
    195|     assert.throws(
       |            ^
    196|       () => apply(service, 2, { concurrency: { defaultWorkers: 2 } }),
    197|       /live bytes changed before replacement/,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 9 skipped (10)
   Start at  07:52:57
   Duration  421ms (transform 150ms, setup 0ms, import 227ms, tests 106ms, environment 0ms)
```

### M11 — directory owner check

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses a directory owned by another uid' --reporter=dot
```

Exit 1, tool chunk f70989:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

----x--------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses a directory owned by another uid before publishing a lock
AssertionError: The input did not match the regular expression /settings directory.*untrusted owner uid/u. Input:

'AggregateError: settings read for /tmp/hrauto-settings-foreign-directory-c1WzlJ/settings.json failed and its exclusive settings authority could not release'


- Expected:
/settings directory.*untrusted owner uid/u

+ Received:
AggregateError {
  "message": "settings read for /tmp/hrauto-settings-foreign-directory-c1WzlJ/settings.json failed and its exclusive settings authority could not release",
  "cause": Error {
    "message": "settings authority lock /tmp/hrauto-settings-foreign-directory-c1WzlJ/settings.json.lock is owned by uid 501, not runtime uid 502",
  },
  "errors": [
    Error {
      "message": "settings initialization evidence /tmp/hrauto-settings-foreign-directory-c1WzlJ/settings.json.authority.json is owned by uid 501, not runtime uid 502",
    },
    Error {
      "message": "settings authority lock /tmp/hrauto-settings-foreign-directory-c1WzlJ/settings.json.lock is owned by uid 501, not runtime uid 502",
    },
  ],
}

 ❯ tests/unit/config.test.ts:296:14
    294|     const uidObservation = vi.spyOn(process, "getuid").mockReturnValue…
    295|     try {
    296|       assert.throws(() => createSettingsFileAuthority({
       |              ^
    297|         path: join(root, "settings.json"),
    298|       }).read(), /settings directory.*untrusted owner uid/u);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:53:15
   Duration  516ms (transform 254ms, setup 0ms, import 380ms, tests 39ms, environment 0ms)
```

### M12 — application symlink refusal

Command (cwd is the assigned worktree):

```sh
env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npx vitest run tests/unit/config.test.ts -t 'refuses application directory symlinks' --reporter=dot
```

Exit 1, tool chunk c2676b:

```text
RUN  v4.1.10 /Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1

---x---------------------------------------

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |unit| tests/unit/config.test.ts > strict config resolution > refuses application directory symlinks without touching their targets
AssertionError: Missing expected exception.

simple

 ❯ tests/unit/config.test.ts:280:16
    278|       symlinkSync(target, alias);
    279|       for (const path of [join(alias, "settings.json"), join(alias, "m…
    280|         assert.throws(() => createSettingsFileAuthority({ path }).read…
       |                ^
    281|         assert.deepEqual(readdirSync(target), []);
    282|         assert.equal(lstatSync(alias).isSymbolicLink(), true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 42 skipped (43)
   Start at  07:53:16
   Duration  472ms (transform 244ms, setup 0ms, import 356ms, tests 34ms, environment 0ms)
```
