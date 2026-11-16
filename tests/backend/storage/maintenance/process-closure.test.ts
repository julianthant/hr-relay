import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { profileProcessQuery, proveProfileRootsUnused } from "../../../../src/backend/storage/maintenance/process-closure.js";

afterEach(() => vi.restoreAllMocks());
const result = (stdout: string, status = 0, stderr = "") => ({ pid: 0, output: [], stdout, stderr, status, signal: null });

it("refuses process closure off macOS without querying the OS", () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platform);
  const query = vi.spyOn(profileProcessQuery, "spawnSync");
  try {
    Object.defineProperty(process, "platform", { value: "win32" });
    assert.throws(() => proveProfileRootsUnused([]), /profile-process-closure-unproved/u);
    assert.equal(query.mock.calls.length, 0);
  } finally {
    Object.defineProperty(process, "platform", platform);
    query.mockRestore();
  }
});

describe.skipIf(process.platform !== "darwin")("complete process and descriptor closure observations", () => {
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

  it("accepts nonempty descriptor names with and without a type in each file set", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "relay-process-closure-"));
    try {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result("p123\nf1\ntREG\nn/synthetic-other\nf2\nn/synthetic-second\nf3\ntDIR\nn/synthetic-third\np124\nf4\nn/synthetic-fourth\n"));
      proveProfileRootsUnused([root]);
      assert.equal(query.mock.calls.length, 2);
    } finally { rmSync(root, { recursive: true }); }
  });

  for (const typed of [false, true]) it(`refuses a ${typed ? "typed" : "type-absent"} descriptor under the supplied root`, () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "relay-process-closure-"));
    try {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result(`p123\nf1\ntREG\nn/synthetic-other\nf2\n${typed ? "tREG\n" : ""}n${join(root, "state.db")}\n`));
      assert.throws(() => proveProfileRootsUnused([root]), /closure-unproved/u);
      assert.equal(query.mock.calls.length, 2);
    } finally { rmSync(root, { recursive: true }); }
  });

  it("does not inherit an empty-name type allowance from a preceding descriptor", () => {
    for (const type of ["NPOLICY", "NEXUS", "PIPE"]) {
      const accepted = vi.spyOn(profileProcessQuery, "spawnSync");
      accepted.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result(`p123\nf1\nt${type}\nn\n`));
      proveProfileRootsUnused([]);
      assert.equal(accepted.mock.calls.length, 2); accepted.mockRestore();
      const refused = vi.spyOn(profileProcessQuery, "spawnSync");
      refused.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result(`p123\nf1\nt${type}\nn\nf2\nn\n`));
      assert.throws(() => proveProfileRootsUnused([]), /closure-unproved/u);
      assert.equal(refused.mock.calls.length, 2); refused.mockRestore();
    }
  });

  it("refuses empty, missing, malformed or unframed untyped descriptor names", () => {
    for (const stdout of ["p123\nf1\nn\n", "p123\nf1\n", "p123\nf1\nn/other", "p123\nf1\nxunknown\nn/other\n",
      "p123\nf1\nn/other\ntREG\n", "p123\nf1\ntREG\ntDIR\nn/other\n"]) {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n")).mockReturnValueOnce(result(stdout));
      assert.throws(() => proveProfileRootsUnused([]), /closure-unproved/u);
      assert.equal(query.mock.calls.length, 2); query.mockRestore();
    }
  });

  for (const type of ["", "VREG", "VDIR", "VLNK", "VCHR", "VBLK", "DIR", "REG", "CHR", "BLK", "LINK", "FIFO", "GDIR", "GREG"]) {
    it(`requires normalized absolute filesystem names with ${type || "no type"}`, () => {
      const empty = vi.spyOn(profileProcessQuery, "spawnSync");
      empty.mockReturnValueOnce(result(" 123 synthetic-worker\n")).mockReturnValueOnce(result(`p123\nf99\n${type ? `t${type}\n` : ""}n\n`));
      assert.throws(() => proveProfileRootsUnused([]), /profile-process-closure-unproved/u);
      assert.equal(empty.mock.calls.length, 2); empty.mockRestore();
      for (const target of ["vnode: FD unavailable", "relative/target", "/synthetic/../other", "/synthetic//other", "/synthetic\0other"]) {
        const query = vi.spyOn(profileProcessQuery, "spawnSync");
        query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
          .mockReturnValue(result(`p123\nf99\n${type ? `t${type}\n` : ""}n${target}\n`));
        assert.throws(() => proveProfileRootsUnused([]), /profile-process-closure-unproved/u);
        assert.equal(query.mock.calls.length, 6); query.mockRestore();
      }
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result(`p123\nf99\n${type ? `t${type}\n` : ""}n/synthetic-other\n`));
      proveProfileRootsUnused([]);
      assert.equal(query.mock.calls.length, 2);
    });
  }

  for (const type of ["IPv4", "IPv6", "unix", "PIPE", "KQUEUE", "NPOLICY", "NEXUS", "systm"]) {
    it(`preserves non-path ${type} descriptor handling`, () => {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result(`p123\nf1\nt${type}\nn${type === "IPv4" ? "127.0.0.1:1234" : "synthetic endpoint"}\n`));
      proveProfileRootsUnused([]);
      assert.equal(query.mock.calls.length, 2);
    });
  }

  it("validates path names even for other descriptor types", () => {
    for (const target of ["/synthetic/../other", "/synthetic//other", "/synthetic\0other"]) {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValue(result(`p123\nf1\ntunix\nn${target}\n`));
      assert.throws(() => proveProfileRootsUnused([]), /profile-process-closure-unproved/u);
      assert.equal(query.mock.calls.length, 6); query.mockRestore();
    }
  });

  it("accepts the next fully resolved census after a descriptor closes mid-census", () => {
    const query = vi.spyOn(profileProcessQuery, "spawnSync");
    query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
      .mockReturnValueOnce(result("p123\nf1\ntREG\nn/synthetic-other\nf99\nnvnode: FD unavailable\n"))
      .mockReturnValueOnce(result("p123\nf1\ntREG\nn/synthetic-other\n"));
    proveProfileRootsUnused([]);
    assert.equal(query.mock.calls.length, 3);
  });

  it("refuses a root match in a later census even after an unresolved one", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "relay-process-closure-"));
    try {
      const query = vi.spyOn(profileProcessQuery, "spawnSync");
      query.mockReturnValueOnce(result(" 123 synthetic-worker\n"))
        .mockReturnValueOnce(result("p123\nf99\nnvnode: FD unavailable\n"))
        .mockReturnValueOnce(result(`p123\nf2\ntREG\nn${join(root, "state.db")}\n`));
      assert.throws(() => proveProfileRootsUnused([root]), /closure-unproved/u);
      assert.equal(query.mock.calls.length, 3);
    } finally { rmSync(root, { recursive: true }); }
  });
});
