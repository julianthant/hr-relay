import { spawnSync } from "node:child_process";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { windowsObserverPolicyPrelude } from "../windows-observer-policy.js";

// Inspect only in a child: closing a descriptor for a SQLite source inode can release the caller's locks.
// SQLite's fileformat2 and walformat specifications define the frame chain and the duplicated index header.
const checkWal = `
const fs = require("node:fs");
const littleEndian = require("node:os").endianness() === "LE";
const [path, limit] = process.argv.slice(1);
function requireMatch(condition) { if (!condition) process.exit(1); }
const observations = [];
function source(suffix, prefix) {
  const name = path + suffix;
  const before = fs.lstatSync(name, { bigint: true });
  requireMatch(before.isFile() && before.nlink === 1n && before.size > 0n);
  requireMatch(${process.platform === "win32" ? '!privatePathRejects(name, before, "group-write")' : "(before.mode & 0o022n) === 0n"});
  const length = prefix ?? Number(before.size);
  requireMatch(length <= Number(limit) && BigInt(length) <= before.size);
  const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  function sameFile(stat) {
    return stat.dev === before.dev && stat.ino === before.ino && stat.ctimeNs === before.ctimeNs && stat.size === before.size;
  }
  try {
    requireMatch(sameFile(fs.fstatSync(fd, { bigint: true })));
    const bytes = Buffer.alloc(length);
    requireMatch(fs.readSync(fd, bytes, 0, length, 0) === length && sameFile(fs.fstatSync(fd, { bigint: true })));
    observations.push(() => sameFile(fs.lstatSync(name, { bigint: true })));
    return bytes;
  } finally { fs.closeSync(fd); }
}
const index = source("-shm", 96);
requireMatch(index.subarray(0, 48).equals(index.subarray(48, 96)) && index[12] === 1);
const native32 = offset => littleEndian ? index.readUInt32LE(offset) : index.readUInt32BE(offset);
const wal = source("-wal");
const magic = wal.readUInt32BE(0);
requireMatch((magic === 0x377f0682 || magic === 0x377f0683) && wal.readUInt32BE(4) === 3007000 && native32(0) === 3007000);
const pageSize = wal.readUInt32BE(8);
const frames = native32(16);
requireMatch(pageSize >= 512 && pageSize <= 65536 && (pageSize & (pageSize - 1)) === 0
  && frames > 0 && wal.length === 32 + frames * (24 + pageSize)
  && index.subarray(32, 40).equals(wal.subarray(16, 24)));
let first = 0, second = 0;
const word = offset => magic === 0x377f0682 ? wal.readUInt32LE(offset) : wal.readUInt32BE(offset);
function accumulate(start, end) {
  for (let i = start; i < end; i += 8) {
    first = (first + word(i) + second) >>> 0;
    second = (second + word(i + 4) + first) >>> 0;
  }
}
function matches(offset) { return first === wal.readUInt32BE(offset) && second === wal.readUInt32BE(offset + 4); }
accumulate(0, 24);
requireMatch(matches(24));
for (let frame = 32; frame < wal.length; frame += 24 + pageSize) {
  requireMatch(wal.readUInt32BE(frame) > 0 && wal.subarray(frame + 8, frame + 16).equals(wal.subarray(16, 24)));
  accumulate(frame, frame + 8);
  accumulate(frame + 24, frame + 24 + pageSize);
  requireMatch(matches(frame + 16));
}
requireMatch(wal.readUInt32BE(wal.length - pageSize - 20) === native32(20)
  && first === native32(24) && second === native32(28) && observations.every(unchanged => unchanged()));
`;

export function hasIntactStartupWal(path: string, maxBytes: number): boolean {
  const script = process.platform === "win32" ? windowsObserverPolicyPrelude("snapshot") + checkWal : checkWal;
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", script, path, String(maxBytes)], {
    env: workerBootstrapEnvironment(), stdio: "ignore", timeout: 250, killSignal: "SIGKILL", windowsHide: true,
  });
  return result.status === 0 && result.error === undefined;
}
