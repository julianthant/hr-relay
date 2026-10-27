import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { profileProcessQuery, proveProfileRootsUnused } from "../../../../src/backend/storage/maintenance/process-closure.js";

afterEach(() => vi.restoreAllMocks());
const result = (stdout: string, status = 0, stderr = "") => ({ pid: 0, output: [], stdout, stderr, status, signal: null });
describe("complete process and descriptor closure observations", () => {
  it("accepts complete process/cwd framing without opening any profile", () => {
    const query = vi.spyOn(profileProcessQuery, "spawnSync");
    query.mockReturnValueOnce(result(" 123 synthetic-worker\n")).mockReturnValueOnce(result("p123\nfcwd\ntDIR\nn/synthetic-other\n"));
    proveProfileRootsUnused([]);
    assert.equal(query.mock.calls.length, 2);
  });
  it("refuses incomplete or failed OS observations", () => {
    for (const output of [result(""), result(" 123 synthetic-worker\n", 1), result(" 123 synthetic-worker\n", 0, "partial"), result("malformed\n")]) {
      const query = vi.spyOn(profileProcessQuery, "spawnSync").mockReturnValue(output);
      assert.throws(() => proveProfileRootsUnused([]), /closure-unproved/u); query.mockRestore();
    }
    for (const stdout of ["", "p123\n", "p123\nfcwd\ntDIR\n", "p123\nfcwd\ntDIR\nn/other", "n/other\n", "p123\nfcwd\ntDIR\nn/other\ntrailing\n"]) {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n")).mockReturnValueOnce(result(stdout));
      assert.throws(() => proveProfileRootsUnused([]), /closure-unproved/u); query.mockRestore();
    }
  });
});
