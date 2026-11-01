export type PrivacyRule = "owner" | "ancestor" | "group-write" | "directory-0700" | "file-0600" | "owner-write-only";

interface PathStat {
  readonly mode: number | bigint;
  readonly uid: number | bigint;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isSymbolicLink(): boolean;
}

export function privatePathRejects(_path: string, stat: PathStat, rule: PrivacyRule): boolean {
  if (stat.isSymbolicLink() || typeof process.getuid !== "function") return true;
  const owner = BigInt(stat.uid), current = BigInt(process.getuid());
  const mode = Number(stat.mode);
  if (rule === "ancestor") {
    return (owner !== current && owner !== 0n) || ((mode & 0o022) !== 0 && (mode & 0o1000) === 0);
  }
  if (owner !== current) return true;
  if (rule === "owner") return false;
  if (rule === "group-write") return (mode & 0o022) !== 0;
  if (rule === "directory-0700") return (mode & 0o7777) !== 0o700;
  if (rule === "file-0600") return (mode & 0o7777) !== 0o600;
  return (mode & 0o222) !== 0o200;
}
