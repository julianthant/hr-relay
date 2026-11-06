/** Repo-relative POSIX path plus raw-byte digests over a file set; shared by the dashboard bundle identity and the app build id. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function filesUnder(root: string, into: string[]): void {
  const info = lstatSync(root);
  if (!info.isDirectory()) throw new Error(`build input is not a directory: ${root}`);
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) filesUnder(path, into);
    else if (entry.isFile()) into.push(path);
    else throw new Error(`build input contains an unsafe entry: ${relative(root, path)}`);
  }
}

export function digestFiles(base: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(base, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}
