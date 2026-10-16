
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { browserSessionOfSpanPath, nodeIdOfTaskSpanPath } from "../../../../src/backend/runs/lifecycle/support.js";
const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("the browser span path is read, never guessed", () => {
  it("reads the system and session id the emitter composed", () => {
    assert.deepEqual(
      browserSessionOfSpanPath(`worker/person-lookup/person-lookup-worker-1/browser:ucpath#${SESSION}`, "ucpath"),
      { sessionId: SESSION, system: "ucpath" },
    );
  });

  it("refuses a path that names no session, rather than folding a guessed one", () => {

    assert.throws(
      () => browserSessionOfSpanPath("worker/person-lookup-worker-1/ucpath"),
      /does not name a session/,
    );
  });

  it("refuses a span whose declared system disagrees with its own path", () => {
    assert.throws(
      () => browserSessionOfSpanPath(`worker/person-lookup/w1/browser:ucpath#${SESSION}`, "crm"),
      /declares system crm while its own path names ucpath/,
    );
  });
});

describe("task span node identity", () => {
  const trace = "pl-120000-abcd";
  it("preserves hash-attempt task paths, including nested task names", () => {
    assert.equal(nodeIdOfTaskSpanPath(`${trace}/searching#1`), "searching");
    assert.equal(nodeIdOfTaskSpanPath(`${trace}/finalize-kuali/finalize#1.1`), "finalize");
  });
  it.each(["probe", "prepare", "commit", "verify"])("resolves the transaction %s role", role => {
    assert.equal(nodeIdOfTaskSpanPath(`${trace}/submit-write/${role}`), "submit-write");
  });
  it.each([
    "", "submit-write", `${trace}/submit-write`, `${trace}/submit-write/task`,
    `${trace}/submit-write/rollback`, `${trace}/submit-write/Prepare`,
    `${trace}/submit-write/probe/extra`, `prefix/${trace}/submit-write/probe`,
    `${trace}//probe`, `/submit-write/probe`, `${trace}/submit-write/`,
    "invalid-trace/submit-write/probe", `${trace}/InvalidNode/probe`, `${trace}/node:name/probe`,
  ])("leaves a malformed or unknown role path unresolved: %s", path => {
    assert.equal(nodeIdOfTaskSpanPath(path), undefined);
  });
});
