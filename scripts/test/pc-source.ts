import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix } from "node:path";

const repository = "https://github.com/julianthant/hr-relay.git";
type Entry = { path: string; mode: string; oid: string };
export type PcSource = { baseCommit: string; tree: string; identity: string; deltaBytes: number };

export function pcSyncFiles(files: readonly string[]): string[] {
  return files.filter(file => !file.split("/").some(part =>
    [".git", "node_modules", "dist", ".work", ".worktrees", ".tracker", "credentials", ".local-private"].includes(part)
    || part === ".env" || part.startsWith(".env."))
    && file !== "config/test-data.local.json");
}

function git(root: string, args: string[], input?: Buffer | string): string {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function checkedPath(path: string) {
  assert(path && !isAbsolute(path) && !path.split("/").some(part => ["", ".", ".."].includes(part)), "Invalid PC source path");
  assert(pcSyncFiles([path]).length === 1, `Excluded PC source path: ${path}`);
}

function checkedLink(path: string, target: string) {
  const destination = posix.relative("/source", posix.resolve("/source", posix.dirname(path), target));
  assert(!isAbsolute(target) && !posix.isAbsolute(target) && destination !== ".." && !destination.startsWith("../"), `Unsafe PC source link: ${path}`);
  if (destination) checkedPath(destination);
}

function entries(root: string, paths: string[], store?: { root: string; objects: Set<string> }): Entry[] {
  return [...new Set(paths)].sort().flatMap(path => {
    checkedPath(path);
    const stat = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (!stat) return [];
    for (let parent = dirname(path); parent !== "."; parent = dirname(parent)) {
      assert(!lstatSync(join(root, parent)).isSymbolicLink(), `PC source ancestor is a link: ${path}`);
    }
    assert(stat.isFile() || stat.isSymbolicLink(), `Unsupported PC source entry: ${path}`);
    const link = stat.isSymbolicLink() ? readlinkSync(join(root, path)) : undefined;
    if (link !== undefined) checkedLink(path, link);
    const bytes = link === undefined ? readFileSync(join(root, path)) : Buffer.from(link);
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (store && !store.objects.has(oid)) {
      git(store.root, ["hash-object", "--no-filters", "-w", "--stdin"], bytes);
      store.objects.add(oid);
    }
    return [{ path, mode: link !== undefined ? "120000" : stat.mode & 0o111 ? "100755" : "100644", oid }];
  });
}

function index(root: string, files: Entry[]): string {
  git(root, ["read-tree", "--empty"]);
  git(root, ["update-index", "-z", "--index-info"], files.map(file => `${file.mode} ${file.oid}\t${file.path}\0`).join(""));
  return git(root, ["write-tree"]).trim();
}

function baseEntries(root: string, base: string): Entry[] {
  return git(root, ["ls-tree", "-rz", base]).split("\0").filter(Boolean).flatMap(row => {
    const tab = row.indexOf("\t");
    const path = row.slice(tab + 1);
    if (pcSyncFiles([path]).length === 0) return [];
    checkedPath(path);
    const [mode, , oid] = row.slice(0, tab).split(" ");
    assert(mode && oid && ["100644", "100755", "120000"].includes(mode), `Unsupported PC base entry: ${path}`);
    return [{ path, mode, oid }];
  });
}

const identity = (files: Entry[]) => createHash("sha256").update(JSON.stringify([...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0))).digest("hex");

export function buildPcSource(root: string, run: string, requestedBase?: string): PcSource {
  const published = git(root, ["ls-remote", "origin", "refs/heads/*", "refs/tags/*"]).trim().split("\n").map(line => line.split("\t"));
  const baseCommit = requestedBase ?? published.find(([, ref]) => ref === "refs/heads/staging")?.[0];
  assert(baseCommit && /^[a-f0-9]{40}$/u.test(baseCommit), "Invalid PC source base");
  assert(published.some(([oid]) => oid === baseCommit), "PC source base is not advertised on origin");
  git(root, ["fetch", "--quiet", "--no-write-fetch-head", "origin", baseCommit]);
  const store = join(run, "source.git");
  mkdirSync(store, { recursive: true });
  git(store, ["init", "--bare", "--quiet"]);
  writeFileSync(join(store, "objects/info/alternates"), git(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]).trim() + "\n");
  const baseFiles = baseEntries(store, baseCommit);
  const base = index(store, baseFiles);
  const paths = pcSyncFiles(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean));
  const files = entries(root, paths, { root: store, objects: new Set(baseFiles.map(file => file.oid)) });
  const tree = index(store, files);
  const patch = execFileSync("git", ["diff", "--binary", "--full-index", "--no-renames", "--no-ext-diff", "--no-textconv", base, tree], { cwd: store, maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(join(run, "source.patch"), patch);
  writeFileSync(join(run, "sync-files"), files.map(file => file.path).join("\0") + "\0");
  return { baseCommit, tree, identity: identity(files), deltaBytes: patch.length };
}

export function preparePcSource(slot: string, origin = repository): void {
  const request: unknown = JSON.parse(readFileSync(join(slot, "request.json"), "utf8"));
  assert(request && typeof request === "object" && "source" in request, "Missing PC source identity");
  const source = request.source;
  assert(source && typeof source === "object"
    && "baseCommit" in source && typeof source.baseCommit === "string" && /^[a-f0-9]{40}$/u.test(source.baseCommit)
    && "tree" in source && typeof source.tree === "string" && /^[a-f0-9]{40}$/u.test(source.tree)
    && "identity" in source && typeof source.identity === "string" && /^[a-f0-9]{64}$/u.test(source.identity)
    && "deltaBytes" in source && typeof source.deltaBytes === "number" && Number.isSafeInteger(source.deltaBytes) && source.deltaBytes >= 0,
  "Invalid PC source identity");
  const store = join(slot, "source.git");
  mkdirSync(store, { recursive: true });
  git(store, ["init", "--bare", "--quiet"]);
  git(store, ["fetch", "--quiet", "--depth=1", origin, source.baseCommit]);
  index(store, baseEntries(store, source.baseCommit));
  const patch = readFileSync(join(slot, "source.patch"));
  assert(patch.length === source.deltaBytes, "PC source delta size mismatch");
  if (patch.length) git(store, ["apply", "--cached", "--binary", "--whitespace=nowarn", join(slot, "source.patch")]);
  assert(git(store, ["write-tree"]).trim() === source.tree, "PC source tree identity mismatch");
  for (const file of baseEntries(store, source.tree)) {
    if (file.mode === "120000") checkedLink(file.path, git(store, ["cat-file", "blob", file.oid]));
  }
  const work = join(slot, "work");
  mkdirSync(work, { recursive: true });
  writeFileSync(join(store, "info/attributes"), "* -text -filter -ident -working-tree-encoding\n");
  git(store, [`--work-tree=${work}`, "-c", "core.symlinks=true", "checkout-index", "--all", "--force", `--prefix=${work}/`]);
  const walk = (directory: string): string[] => readdirSync(join(work, directory), { withFileTypes: true }).flatMap(file => {
    const path = directory ? `${directory}/${file.name}` : file.name;
    if (path === "node_modules") return [];
    return file.isDirectory() ? walk(path) : [path];
  });
  assert(identity(entries(work, walk(""))) === source.identity, "PC source tree identity mismatch");
}
