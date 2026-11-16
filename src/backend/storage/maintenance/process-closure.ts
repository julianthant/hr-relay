import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export const profileProcessQuery = { spawnSync };
const refuse = (): never => { throw new Error("profile-process-closure-unproved"); };

function requireRoot(path: string, descendants = false): void {
  if (resolve(path) !== path) refuse();
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info === undefined) { const parent = dirname(path); if (parent !== path) requireRoot(parent); return; }
  if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(path) !== path) refuse();
  if (descendants) for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) refuse();
    if (entry.isDirectory()) requireRoot(join(path, entry.name), true);
  }
}

/** Process arguments and filenames stay private. An incomplete OS query never proves absence. */
export function proveProfileRootsUnused(roots: readonly string[]): void {
  if (process.platform !== "darwin") refuse();
  const query = (command: string, args: string[]) => {
    const result = profileProcessQuery.spawnSync(command, args, { encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
    if (result.error !== undefined || result.signal !== null || result.stderr.length !== 0
      || result.status !== 0) refuse();
    return result.stdout;
  };
  const processes = query("/bin/ps", ["-axo", "pid=,command=", "-ww"]);
  if (processes.trim().length === 0 || processes.split("\n").filter(Boolean).some(line => !/^\s*\d+\s+\S/u.test(line))
    || roots.some(root => processes.includes(root))) refuse();
  for (const root of roots) requireRoot(root, true);
  // A descriptor that closes mid-census reads as unresolved; only a fully resolved snapshot proves absence.
  for (let attempt = 0; attempt < DESCRIPTOR_CENSUS_ATTEMPTS; attempt++) {
    if (descriptorsResolvedOutsideRoots(query("/usr/sbin/lsof", ["-nP", "-F", "pftn"]), roots)) return;
  }
  refuse();
}

const DESCRIPTOR_CENSUS_ATTEMPTS = 5;
const FILESYSTEM_TYPES = ["", "VREG", "VDIR", "VLNK", "VCHR", "VBLK", "DIR", "REG", "CHR", "BLK", "LINK", "FIFO", "GDIR", "GREG"];

function descriptorsResolvedOutsideRoots(stdout: string, roots: readonly string[]): boolean {
  const fields = stdout.split("\n");
  if (fields.pop() !== "" || fields.length === 0) refuse();
  let state: "process" | "file" | "type" | "name" | "complete" = "process";
  let fileType = "";
  let resolved = true;
  for (const field of fields) {
    if (/^p[1-9]\d*$/u.test(field) && (state === "process" || state === "complete")) state = "file";
    else if (field.startsWith("f") && field.length > 1 && (state === "file" || state === "complete")) { fileType = ""; state = "type"; }
    else if (field.startsWith("t") && field.length > 1 && state === "type") { fileType = field.slice(1); state = "name"; }
    else if (field.startsWith("n") && (state === "name" || state === "type") && (field.length > 1 || ["NPOLICY", "NEXUS", "PIPE"].includes(fileType))) {
      const name = field.slice(1);
      if (roots.some(root => name === root || name.startsWith(`${root}${sep}`))) refuse();
      if ((FILESYSTEM_TYPES.includes(fileType) || isAbsolute(name))
        && (!isAbsolute(name) || resolve(name) !== name || name.includes("\0"))) resolved = false;
      state = "complete";
    } else refuse();
  }
  if (state !== "complete") refuse();
  return resolved;
}
