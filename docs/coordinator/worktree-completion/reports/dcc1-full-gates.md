# sup_sol_DCC1_frozen_full_gates

## Archival note — 2026-08-30

Lossless `.gz` copies now accompany the exact inventoried plaintext evidence; originals remain
untouched. Evidence links below resolve to archives. All historical commands, literal raw paths,
verdicts, byte counts and SHA256 values still describe the original plaintext, recovered with
`gzip -d -c ARCHIVE_PATH`. This packaging does not change evidence provenance or imply a commit.
See [packaging manifest](../evidence/dcc1-packaging-manifest.json) for original-to-archive mapping,
both hashes, original staged blobs and round-trip receipts. Index replacement/freeze is parent-owned.
Historical status and staging statements below remain statements about their original receipt time.


## STATUS / ROLE / MODEL / REASONING / COMMITS

**RED — coverage failed; parity not run.** Gate-only assignment stopped without repair.
ROLE: same resumed native sup_sol executor, no delegation. MODEL: native Sol.
REASONING: high; assigned profile budgets unchanged (240k/220k). COMMITS: none.
No source/test/config/reference/AGENTS edit, staging, retry, or follow-on gate.

Coordinator explicitly opened DCC1 heavy allocation. Complete queue handoff, renewed freeze,
supervise/UI instructions and applicable retained AGENTS/profile were read. UI scope remained
the existing asserted parity lane; no independent UI audit, manual browser, or live HR action.
The initial failed helper-path lookup was a read-only lookup error, not a gate failure;
the correct bundle.ts and reference-store.ts were subsequently read.

## Gate receipt

| Gate | Session | Start/end UTC, 2026-08-30 | Gate exit | Logger exit | Outcome |
| --- | --- | --- | --- | --- | --- |
| Full coverage | 87688 | 16:36:28 → 16:41:39 | 1 | 0 | 1 failed / 334 passed files; 1 failed / 3,786 passed tests |
| Asserted parity | Not started | — | — | — | Withheld after coverage red |

Vitest duration: **310.16s**. Exact failure:
`tests/unit/architecture/control-command-single-path.test.ts:278`,
“keeps the command journal, audit, and start-plan consumption on exactly one executing path”.
Observed violation:
`src/server/settings-runtime.ts may only authenticate settings through one commandAudits.findByCommand read`.

No coverage floor pass is claimed; the command failed in its test phase. The chained
`tsx scripts/suite-size.ts` did not run after Vitest exited 1.
Warnings about PDF indexing, Node localStorage, and React act(...) remain in the raw output.

Parent received the gate-start notice. At the first failure marker, coordinator and parent
received an immediate provisional red notice explaining that the process/OS lock remained active.
The command completed naturally. **Both then received the terminal RELEASE notice before any
postflight or report work**, including named failure, exact command, session and independent
gate/logger exits. The OS lock was released by process exit; no lock was unlinked or probed.
No owned command remains active. DCC1 heavy ownership is released.

## Frozen input verification

Every command/edit used
`/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1`.

- Branch: `feature/r-dcc-dcc1-exclusive`.
- HEAD: `0c115123a738f62cbe01c9b45f53b7289284479c`.
- MERGE_HEAD: `13175b13340fec7b5326207fe54f98078d481d7d`.
- Complete index, before and after: `0b5ae741d88e83b816705dd3ecf504dd5ebeaf59`.
- Full execution closure, before and after:
  `36ec6220ce59f8fc9c63eae3057df32771bbd28b0ea055de243f83efaeb5a29e`.
- Reference subtree: `2821164f92b32c11ab39acdd9dddb6064f4ce9d1`; zero working/reference delta.
- Zero unresolved entries. Original merge and all parent artifacts preserved.
- Runtime blob remains `ec2933b2587eee5359abd0c7d7b44952ff9d38de`.
- Settings-runtime blob `ddf323be869cbcf61a031bfb710a32e8a82bda06`;
  failing guard blob `dc10fa414fc60b4f0115ae943cef9f58919bd8b0`.

Preflight matched the COMPLETE freeze ledger: npm graph, installed lock, tracked package-lock,
browser manifest and Chromium executable, Node/npm/macOS versions, legacy GUARD HEAD and
three dirty-file hashes, all six subtree hashes, full index/working/untracked/ignored inventory.
Only guard metadata and the three declared legacy files were read; no live authority or credentials.
Exact invoked command/args/cwd, complete stdout/stderr and exits are retained in the annotated
preflight transcript below. Preflight exit 0.

Postflight (16:42:06.564Z) verified unchanged index/closure/tracked/reference inputs, no unresolved
entries, and only the two new logs alongside the existing untracked freeze/handoff.
Ignored inventory remains node_modules/ only. No bundle stamp exists: parity never started,
so no buildstamp/input/output digest or rendered parity success is fabricated.
No dependency installation, reference update, threshold/timeout/assertion change, or light gate ran.
The frozen parent lint59056/typecheck91624 evidence remains the preexisting light-gate proof;
this gate-only unit did not rerun lights.

## Durable artifacts and byte hashes

All files below are **untracked, not staged**. The report itself is the third new output;
the preexisting freeze and queue handoff remain preserved.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| [Preflight command/output transcript](../evidence/dcc1-0b5-preflight.raw.log.gz) | 659201 | `1e4657eb9c504d9e3f1e2f8134e24715c1f1e494dece5583182ea5882170547b` |
| [Coverage raw process output](../evidence/dcc1-0b5-coverage.raw.log.gz) | 13719 | `6db1a56603ad76aa3b859445e315a76ee2b1701bbb23ac72d5b573dd6de311e8` |

Coverage log is the exact merged stdout/stderr pipeline byte stream, written synchronously to its
exclusive-created mode0600 disk file **before** forwarding chunks to tool transport. No whitespace
normalization or truncation is applied to that log; fsync and close completed (logger exit0).
Preflight is an annotated transcript whose child output buffers were likewise written directly
before tool transport; its COMMAND/STDOUT/STDERR/EXIT labels are recorder metadata.
Nonexistence of both requested gate log paths was checked before creation; the logger additionally
used wx. The parity raw log does not exist, because that gate never started.
Prior F7/F7b/F7c normalized receipts have not been altered or relabeled as raw logs.

## Exact coverage command and recorder

Gate command:

```sh
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
```

Executed outer shell (zsh, assigned workdir) captures the two pipeline statuses independently:

```sh
set -o pipefail
if [[ -e '/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/docs/coordinator/worktree-completion/evidence/dcc1-0b5-coverage.raw.log' ]]; then print -u2 'Raw output already exists; refusing overwrite'; exit 73; fi
print 'GATE_COMMAND /usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage'
date -u '+GATE_START_UTC %Y-%m-%dT%H:%M:%SZ'
/usr/bin/lockf -k -t 0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage 2>&1 | node --input-type=module -e '
import { openSync, writeSync, fsyncSync, closeSync } from "node:fs";
const fd = openSync(process.argv[1], "wx", 0o600);
try {
  for await (const chunk of process.stdin) {
    for (let offset = 0; offset < chunk.length;) offset += writeSync(fd, chunk, offset);
    process.stdout.write(chunk);
  }
  fsyncSync(fd);
} finally { closeSync(fd); }
' '/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/docs/coordinator/worktree-completion/evidence/dcc1-0b5-coverage.raw.log'
gate_statuses=("${pipestatus[@]}")
date -u '+GATE_END_UTC %Y-%m-%dT%H:%M:%SZ'
print "GATE_EXIT ${gate_statuses[1]} LOGGER_EXIT ${gate_statuses[2]}"
if (( gate_statuses[1] != 0 )); then exit ${gate_statuses[1]}; fi
exit ${gate_statuses[2]}
```

Returned terminal metadata (outside the raw child-output file):

```text
GATE_END_UTC 2026-08-30T16:41:39Z
GATE_EXIT 1 LOGGER_EXIT 0
```

## Postflight exact command/output receipt

This read-only verification ran ONLY after terminal release. No new probe/test or diagnosis was run.

```sh
node --input-type=module <<'NODE'
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const cwd='/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1';
const git=(args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024});
const expected='0b5ae741d88e83b816705dd3ecf504dd5ebeaf59';
const tree=git(['write-tree']).trim();
if(tree!==expected) throw new Error('Index changed: '+tree);
const working=git(['diff','--name-only']);
if(working!=='') throw new Error('Tracked working changes: '+working);
const full=git(['ls-tree','-r','--full-tree',tree]);
const closure=full.split('\n').filter(line=>!/\tdocs\/coordinator\/worktree-completion\/(reports|evidence|handoffs)\//.test(line)).join('\n');
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const digest=sha(Buffer.from(closure));
if(digest!=='36ec6220ce59f8fc9c63eae3057df32771bbd28b0ea055de243f83efaeb5a29e') throw new Error('Closure changed');
console.log('POSTFLIGHT_UTC '+new Date().toISOString());
console.log('INDEX '+tree+'\nCLOSURE '+digest);
console.log('PARENTS\n'+git(['rev-parse','HEAD','MERGE_HEAD']));
console.log('TRACKED_WORKING_DELTA '+JSON.stringify(working));
console.log('REFERENCE_DELTA '+JSON.stringify(git(['diff','--name-only',tree,'--','tests/parity/references'])));
console.log('UNRESOLVED '+JSON.stringify(git(['ls-files','-u'])));
console.log('UNTRACKED\n'+git(['ls-files','--others','--exclude-standard']));
console.log('IGNORED\n'+git(['ls-files','--others','--ignored','--exclude-standard','--directory']));
console.log('REFERENCE_TREE '+git(['rev-parse',tree+':tests/parity/references']).trim());
for(const name of ['dcc1-0b5-preflight.raw.log','dcc1-0b5-coverage.raw.log']){
  const path=cwd+'/docs/coordinator/worktree-completion/evidence/'+name;
  const bytes=readFileSync(path);
  console.log(JSON.stringify({path,bytes:bytes.length,sha256:sha(bytes),gitBlob:git(['hash-object',path]).trim(),mode:(statSync(path).mode&0o777).toString(8)}));
}
console.log('PARITY_LOG_EXISTS '+existsSync(cwd+'/docs/coordinator/worktree-completion/evidence/dcc1-0b5-parity.raw.log'));
console.log('BUILDSTAMP_EXISTS '+existsSync(cwd+'/dist/dashboard/parity-build-stamp.json'));
console.log('SOURCE_BLOBS\n'+git(['hash-object','src/server/dry-run-scenario/runtime.ts','src/server/settings-runtime.ts','tests/unit/architecture/control-command-single-path.test.ts']));
NODE
```

Exit 0; normalized returned verification text (not relabeled raw process output):

```text
POSTFLIGHT_UTC 2026-08-30T16:42:06.564Z
INDEX 0b5ae741d88e83b816705dd3ecf504dd5ebeaf59
CLOSURE 36ec6220ce59f8fc9c63eae3057df32771bbd28b0ea055de243f83efaeb5a29e
PARENTS
0c115123a738f62cbe01c9b45f53b7289284479c
13175b13340fec7b5326207fe54f98078d481d7d

TRACKED_WORKING_DELTA ""
REFERENCE_DELTA ""
UNRESOLVED ""
UNTRACKED
docs/coordinator/worktree-completion/evidence/dcc1-0b5-coverage.raw.log
docs/coordinator/worktree-completion/evidence/dcc1-0b5-preflight.raw.log
docs/coordinator/worktree-completion/evidence/dcc1-f7c-gate-freeze.md
docs/coordinator/worktree-completion/handoffs/2026-08-30-dcc1-frozen-gate-queue.md

IGNORED
node_modules/

REFERENCE_TREE 2821164f92b32c11ab39acdd9dddb6064f4ce9d1
{"path":"/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/docs/coordinator/worktree-completion/evidence/dcc1-0b5-preflight.raw.log","bytes":659201,"sha256":"1e4657eb9c504d9e3f1e2f8134e24715c1f1e494dece5583182ea5882170547b","gitBlob":"2dc4a8c48d35c7c85586ea5d20f7d934b2758fd7","mode":"600"}
{"path":"/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc1/docs/coordinator/worktree-completion/evidence/dcc1-0b5-coverage.raw.log","bytes":13719,"sha256":"6db1a56603ad76aa3b859445e315a76ee2b1701bbb23ac72d5b573dd6de311e8","gitBlob":"483172b9c9c99ca620191ba8d2fa025ccc9dd5da","mode":"600"}
PARITY_LOG_EXISTS false
BUILDSTAMP_EXISTS false
SOURCE_BLOBS
ec2933b2587eee5359abd0c7d7b44952ff9d38de
ddf323be869cbcf61a031bfb710a32e8a82bda06
dc10fa414fc60b4f0115ae943cef9f58919bd8b0
```

## REVIEW-HINT / NOTES

Parent owns any separately scoped read-only diagnosis, repair, renewed proof/allocation and commit.
This report states the observed architecture failure, not an adjudication that production or guard
policy should change. No source repair began. Existing migration-history collision and D75 shared
integration residue remain unchanged; branch-local gates do not establish cross-run compatibility.
Queue handoff is retained because full gate/merge closure remains incomplete.


## Subsequently authorized F8 minimized execution receipts

After the full-gate terminal release and report, coordinator separately authorized ONLY one
minimized guard run and fresh locked lint. These are not a coverage retry or parity run.
The earlier no-follow-on-gate statements describe the original heavy-gate assignment.
No source/guard/index mutation occurred. Diagnosis findings are returned to parent separately;
this appendix records execution receipts only.

| Run | Session | UTC start/end 2026-08-30 | Gate/logger exits | Result |
| --- | --- | --- | --- | --- |
| Exact minimized guard | 50617 | 16:43:06 → 16:43:07 | 1 / 0 | Same named lexical failure; 1 failed, 8 skipped; 929ms |
| Fresh locked lint | 55868 | 16:43:15 → 16:43:43 | 0 / 0 | No diagnostics |

Both raw logs were checked absent before creation and recorded with the same disk-first,
exclusive-created pipeline logger as coverage. No normalization or tool-transport truncation
is applied to the on-disk logs.

- [Focused raw output](../evidence/dcc1-f8-focused.raw.log.gz), SHA-256
  `c8b908fdff86477f85ad1ead04f61670c06ff124802e7f4cc1f4cc692f0b32f5`.
- [Lint raw output](../evidence/dcc1-f8-lint.raw.log.gz), SHA-256
  `cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385`.

Exact command, session 50617:

```sh
env -u PARITY_UPDATE HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test -- tests/unit/architecture/control-command-single-path.test.ts -t 'keeps the command journal, audit, and start-plan consumption on exactly one executing path'
```

Exact command, session 55868:

```sh
/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock npm run lint
```

All owned commands exited; parent received explicit light-lane release. Heavy slot remained
released throughout F8. Frozen index and tracked/reference files remain unchanged. No repair,
mutation sensitivity run, typecheck, full gate, parity, or commit followed.
