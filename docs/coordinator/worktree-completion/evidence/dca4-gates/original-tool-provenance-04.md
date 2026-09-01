# Original pre-execution tool provenance — limitations explicit

The adjacent `original-pre-execution-command-04.txt` copies the **full exact shell command string**
from this task's known original tool-call history. It is a transcript transcription made at close,
NOT an execution now and NOT an independently saved pre-execution script file. The earlier
`original-digest-calculation-receipt-04.md` is only an excerpt with an explanatory temporary
identifier; this full command is the exact historical invocation text.

The original call used `tools.exec_command({cmd: ..., workdir:
"/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4", max_output_tokens:50000})`.
Its Node stdout was one JSON object prefixed `DCA4_JSON=`. Property order placed
`protectedHash:sha(JSON.stringify(protectedMap))` before `protectedMap`. The original captured
digest is `68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6`.

The same original orchestration then performed:

```js
const v=JSON.parse(r.output.slice(r.output.indexOf("DCA4_JSON=")+10));
store("dca4-gates04-before",v);
text({...v,protectedMap:undefined,spec:undefined});
const report={...v,spec:undefined};
// apply_patch wrote JSON.stringify(report,null,2) to frozen-before-04.json
```

Thus the bounded root digest was visible in that original tool result (with the map omitted from
the printed summary) and saved in `frozen-before-04.json` **before** the next tool call launched
the initial scoped assertion at `2026-08-30T16:14:24.191Z`. That ordering is demonstrated by this
task's tool transcript. The original digest call's own timestamp and exec chunk/session ID were
not retained; no exact timestamp or chunk ID is invented here.

There was **no independent complete raw stdout copy**. The original response object `r` was not
stored; the parsed value was. Its map had already acquired the literal truncation placeholder.
The original full map cannot be recovered from that artifact. The root digest remains a
pre-gate, transcript-provenanced scalar, not independent proof that the serialized map was complete.
Original complete path count was not emitted separately. Current1,622 is not relabeled original.

The original before artifact remains unchanged. Current full map and independent current digest
checks are separate files with CURRENT provenance. Parent/coordinator must decide whether this
original scalar/transcript continuity meets their gate evidence requirement; this worker does not
claim that fresh recomputation repairs the missing historical full-map receipt.

Parity polling session IDs and terminal chunk IDs were also not retained (except restoration
verification chunk `d21df5`). The complete command ledger reports known functions execution cells,
raw worker PIDs, exact commands and UTC start/end times, and explicitly marks unavailable
`exec_command.session_id` fields. No claim that worker PIDs are command sessions.
