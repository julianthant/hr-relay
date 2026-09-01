# Original pre-gate04 digest calculation receipt

This is an exact digest-producing excerpt from the original Node command in this task's tool
transcript, not a newly executed original-state reconstruction. The original larger command also
emitted HEAD, branch, source hashes, references, intake hashes, and spec text. It ran before
scoped assertion start 2026-08-30T16:14:24.191Z, with explicit assigned DCA4 workdir.
The digest was computed in Node BEFORE command output crossed the tool transport.

```js
const fs=require('node:fs'), cp=require('node:child_process'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'});
const allowed=/^tests\/parity\/references\/archive-evidence--(?:graphite-warm--1280x720|paper-ink--phone-390x844)\.(?:png|a11y\.yml|meta\.json)$/;
const all=[...new Set(git('ls-files','--cached','--others','--exclude-standard','src','tests','scripts','config').trim().split('\n'))].sort();
const protectedMap=Object.fromEntries(all.filter(p=>!allowed.test(p)).map(p=>[p,fs.existsSync(p)?sha(fs.readFileSync(p)):null]));
// The original larger JSON result included this property:
const protectedHash=sha(JSON.stringify(protectedMap));
```

Original captured result property:
```json
{"protectedHash":"68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6"}
```

This value survives in the unchanged original `frozen-before-04.json`. Its original serialized
`protectedMap` is incomplete: 1,426 entries including one literal truncation placeholder.
The original full map was NOT durably captured. The original complete path count was NOT emitted
in that command. Therefore 1,622 is the subsequently verified CURRENT count, not an independently
preserved pre-gate count. Current root-digest equality supports continuity with the original
pre-gate digest but cannot recover the original lost per-file receipt.

The original command response object (including exec chunk/session metadata) was not retained:
the orchestration parsed stdout and retained the parsed result. This excerpt and original digest
property are transcript-derived evidence; they are not presented as a complete raw tool receipt.

Fresh `protected-current-map-04.json` is explicitly CURRENT, captured after all executed gates.
`protected-independent-current-04.json` independently enumerates current paths with
`git ls-files -z --cached --others --exclude-standard -- src tests scripts config`, excludes
an explicit six-path set, and serializes sorted key/value JSON pairs. Its count is1,622 and its
digest matches both the current saved map and original captured digest. This second algorithm
does not rely on the truncated original per-path map.
