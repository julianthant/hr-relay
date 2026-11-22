import { spawnSync } from "node:child_process";
import { z } from "zod";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { windowsObserverPolicyPrelude } from "../windows-observer-policy.js";

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const fileSchema = z.strictObject({ identity: z.string().min(1), main: hashSchema, wal: hashSchema.nullable() });
export type StartupFile = z.infer<typeof fileSchema>;

// Closing a descriptor for a SQLite source inode can release the caller's locks. Read files in a child.
const observeFiles = `
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const [path, limit] = process.argv.slice(1);
const littleEndian = require("node:os").endianness() === "LE";
const observations = [];
function requireMatch(condition) { if (!condition) process.exit(1); }
function source(suffix, read) {
  const name = path + suffix;
  const stat = () => fs.lstatSync(name, { bigint: true, throwIfNoEntry: false });
  const before = stat();
  if (!before) {
    requireMatch(suffix === "-wal");
    observations.push(() => stat() === undefined);
    return null;
  }
  requireMatch(before.isFile() && before.nlink === 1n && before.size <= BigInt(Number.MAX_SAFE_INTEGER));
  requireMatch(${process.platform === "win32" ? '!privatePathRejects(name, before, "group-write")' : "(before.mode & 0o022n) === 0n"});
  function sameFile(seen) {
    return seen && seen.dev === before.dev && seen.ino === before.ino && seen.ctimeNs === before.ctimeNs && seen.size === before.size;
  }
  const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    requireMatch(sameFile(fs.fstatSync(fd, { bigint: true })));
    const result = read(fd, before);
    requireMatch(sameFile(fs.fstatSync(fd, { bigint: true })));
    observations.push(() => sameFile(stat()));
    return result;
  } finally { fs.closeSync(fd); }
}
const chunk = Buffer.alloc(64 * 1024);
function digest(fd, size) {
  const hash = createHash("sha256");
  for (let pos = 0; pos < size;) {
    const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - pos), pos);
    requireMatch(count > 0);
    hash.update(chunk.subarray(0, count));
    pos += count;
  }
  return hash.digest("hex");
}
function bytes(fd, length) {
  const data = Buffer.alloc(length);
  requireMatch(fs.readSync(fd, data, 0, length, 0) === length);
  return data;
}
// Check the committed WAL frame chain and both copies of SQLite's index header for a dirty close.
function verifyWal(wal) {
  const index = source("-shm", fd => bytes(fd, 96));
  requireMatch(index.subarray(0, 48).equals(index.subarray(48, 96)) && index[12] === 1);
  const native32 = offset => littleEndian ? index.readUInt32LE(offset) : index.readUInt32BE(offset);
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
    && first === native32(24) && second === native32(28));
}
const file = source("", (fd, stat) => ({
  identity: [stat.dev, stat.ino, stat.birthtimeNs].join(":"),
  main: digest(fd, Number(stat.size)),
}));
file.wal = source("-wal", (fd, stat) => {
  const size = Number(stat.size);
  if (size === 0) return null;
  if (limit === undefined) return digest(fd, size);
  requireMatch(size <= Number(limit));
  const wal = bytes(fd, size);
  verifyWal(wal);
  return createHash("sha256").update(wal).digest("hex");
});
requireMatch(observations.every(unchanged => unchanged()));
process.stdout.write(JSON.stringify(file));
`;

export function readStartupFile(path: string, verifyWalUpTo?: number):
  { state: "observed"; file: StartupFile } | { state: "unavailable" } {
  try {
    const script = process.platform === "win32" ? windowsObserverPolicyPrelude("snapshot") + observeFiles : observeFiles;
    const args = ["--input-type=commonjs", "-e", script, path];
    if (verifyWalUpTo !== undefined) args.push(String(verifyWalUpTo));
    const result = spawnSync(process.execPath, args, { env: workerBootstrapEnvironment(), encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], maxBuffer: 4096, timeout: 5000, killSignal: "SIGKILL", windowsHide: true });
    if (result.status !== 0 || result.error !== undefined) return { state: "unavailable" };
    return { state: "observed", file: fileSchema.parse(JSON.parse(result.stdout)) };
  } catch { return { state: "unavailable" }; }
}
