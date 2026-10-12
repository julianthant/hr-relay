
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { browserSessionOfSpanPath } from "../../../../src/backend/runs/lifecycle/support.js";
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
