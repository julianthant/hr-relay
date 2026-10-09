import { tmpdir } from "node:os";
import { manualClock } from "../../../src/rules/time/clock.js";
import { eventStreamDirectory, pruneEventStreams } from "../../../src/backend/storage/events/jsonl-streams.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ts from "typescript";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { deriveLedgerLineDigest } from "../../../src/rules/runs/ledger-projection.js";
import { historyWorld, historicalWorld } from "../../support/helpers/storage/transaction-history-fixture.js";
import { gitVisibleFiles, REPO_ROOT } from "../support/helpers/guard-files.js";
interface Source { path: string; content: string }
export function retiredLedgerConsumerViolations(sources: readonly Source[]) {
  return sources.filter(({ content }) => /(?:from\s+["'][^"']*infra\/ledger\/|\.authority\.(?:durableOutbox|ledgerProjection)\b|(?:createLedgerProjector|createLedgerReadThrough)\s*\()/u.test(content)).map(({ path }) => path);
}
const LEDGER_REFERENCE = /ledgerDirectory\s*\(|ledgerFilePath\s*\(|ledgerFileName\s*\(|["'`]ledger["'`]|\/ledger\//u;
const DELETION_PRIMITIVES = /\b(?:unlinkSync|unlink|rmSync|rmdirSync|rmdir|truncateSync|ftruncateSync|rimraf)\s*\(/u;
/** Pin the reviewed recovery-copy function; an edit cannot expand its deletion exception. */
function withoutVerifiedScratchCleanup(source: Source): string {
  if (source.path !== "src/backend/storage/events/timeline-import.ts") return source.content;
  const file = ts.createSourceFile(source.path, source.content, ts.ScriptTarget.Latest, true);
  const owner = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "preserveTimelineSources");
  if (owner === undefined || createHash("sha256").update(owner.getText(file)).digest("hex") !== "961b8bf1f77ead9a2f547e15ca518bd5db66c25e02c0535884843e6039848771") return source.content;
  const original = owner.getText(file);
  const admitted = original.replace("rmSync(temporary, { recursive: true, force: true });", "");
  return source.content.slice(0, owner.getStart(file)) + admitted + source.content.slice(owner.end);
}
function withoutValidatedEventPrune(source: Source): string {
  if (source.path !== "src/backend/storage/events/jsonl-streams.ts") return source.content;
  const file = ts.createSourceFile(source.path, source.content, ts.ScriptTarget.Latest, true);
  const functions = new Map(file.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node]));
  const prune = functions.get("pruneEventStreams"), directory = functions.get("eventStreamDirectory"), list = functions.get("listEventStreamFiles");
  if (prune?.body === undefined || directory?.body === undefined || list?.body === undefined) return source.content;
  const printer = ts.createPrinter({ removeComments: true });
  const compact = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, file).replaceAll(/\s+/gu, "");
  const directoryBody = compact(directory.body);
  if (directoryBody !== '{returnjoin(stateRoot,EventStreamSchema.parse(stream));}') return source.content;
  const declarations = file.statements.filter(ts.isVariableStatement).flatMap(statement =>
    statement.declarationList.declarations.map(declaration => ({ statement, declaration })));
  for (const [name, initializer] of [
    ["EVENT_STREAMS", '["spans","notes"]asconst'],
    ["EventStreamSchema", 'z.enum(EVENT_STREAMS)'],
    ["STREAM_FILE_PATTERN", '/^([a-z0-9]+(?:-[a-z0-9]+)*)-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$/'],
  ]) {
    const matches = declarations.filter(({ declaration }) => declaration.name.getText(file) === name);
    if (matches.length !== 1 || (matches[0].statement.declarationList.flags & ts.NodeFlags.Const) === 0
      || matches[0].declaration.initializer === undefined || compact(matches[0].declaration.initializer) !== initializer) return source.content;
  }
  if (prune.parameters.length !== 1 || prune.parameters[0].name.getText(file) !== "input"
    || directory.parameters.map(parameter => parameter.name.getText(file)).join(",") !== "stateRoot,stream"
    || list.parameters.map(parameter => parameter.name.getText(file)).join(",") !== "stateRoot,stream") return source.content;
  const body = compact(prune.body);
  const required = '{constretentionDays=z.number().int().positive().parse(input.retentionDays??EVENT_STREAM_RETENTION_DAYS);constcutoff=newDate(input.clock.now().getTime()-retentionDays*24*60*60*1000);constcutoffDate=localDatePart(cutoff);constremoved:string[]=[];conststreams=z.array(EventStreamSchema).parse(input.streams??EVENT_STREAMS);for(conststreamofstreams){for(constfileoflistEventStreamFiles(input.stateRoot,stream)){if(file.date<cutoffDate){unlinkSync(file.path);removed.push(file.path);}}}returnObject.freeze({cutoffDate,removed:Object.freeze(removed)});}';
  if (body !== required) return source.content;
  const listing = compact(list.body);
  const expectedListing = '{constdirectory=eventStreamDirectory(stateRoot,stream);if(!existsSync(directory))return[];constfiles:EventStreamFile[]=[];for(constnameofreaddirSync(directory)){constmatch=STREAM_FILE_PATTERN.exec(name);if(match===null){thrownewError(`${stream}/contains${name},whichisnota<workflow>-<date>.jsonlstreamfile;refusingtoenumeratearoundit`);}files.push({stream,workflow:match[1],date:match[2],path:join(directory,name)});}returnfiles.sort((a,b)=>(a.date===b.date?a.workflow.localeCompare(b.workflow):a.date.localeCompare(b.date)));}';
  if (listing !== expectedListing) return source.content;
  const bindings = new Map<string, number>();
  let shadowed = false;
  const protectedBindings = new Set(["z", "join", "EVENT_STREAMS", "EventStreamSchema", "STREAM_FILE_PATTERN", "listEventStreamFiles", "eventStreamDirectory"]);
  const aliases = new Map<string, ts.Expression>();
  for (const { declaration } of declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) aliases.set(declaration.name.text, declaration.initializer);
  function protectedRoot(node: ts.Expression, seen = new Set<string>()): boolean {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return protectedRoot(node.expression, seen);
    if (!ts.isIdentifier(node)) return false;
    if (protectedBindings.has(node.text)) return true;
    if (seen.has(node.text)) return false;
    seen.add(node.text);
    const initializer = aliases.get(node.text);
    return initializer !== undefined && protectedRoot(initializer, seen);
  }
  function inspect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) {
      const name = node.name?.getText(file);
      if (name !== undefined) bindings.set(name, (bindings.get(name) ?? 0) + 1);
      if (name === "z" || name === "join") shadowed = true;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && protectedRoot(node.left)) shadowed = true;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      if (protectedRoot(receiver) && /^(?:push|pop|splice|shift|unshift|sort|reverse|fill|copyWithin|set|delete|clear|defineProperty)$/u.test(node.expression.name.text)) shadowed = true;
      if (["Object.assign", "Object.defineProperty", "Reflect.set", "Reflect.defineProperty"].includes(node.expression.getText(file))
        && node.arguments[0] !== undefined && protectedRoot(node.arguments[0])) shadowed = true;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  if (shadowed || ["EVENT_STREAMS", "EventStreamSchema", "STREAM_FILE_PATTERN", "pruneEventStreams", "eventStreamDirectory", "listEventStreamFiles"].some(name => bindings.get(name) !== 1)) return source.content;
  for (const [name, module] of [["z", "zod"], ["join", "node:path"]]) {
    if (!file.statements.some(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === module && node.importClause?.namedBindings !== undefined
      && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.some(binding => binding.name.text === name && binding.propertyName === undefined))) return source.content;
  }
  const removed = prune.getText(file).replace('unlinkSync(file.path);', '');
  return source.content.slice(0, prune.getStart(file)) + removed + source.content.slice(prune.end);
}

export function ledgerSoleWriterViolations(sources: readonly Source[]) {
  return sources.filter(({ content }) => LEDGER_REFERENCE.test(content)
    && /\bappendFile(?:Sync)?\s*\(|openSync\s*\([^)]*["'`]a["'`]/u.test(content)).map(({ path }) => path);
}
export function ledgerPruneReachabilityViolations(sources: readonly Source[]) {
  return sources.filter((source) => (LEDGER_REFERENCE.test(source.content) || source.path.startsWith("src/backend/storage/events/"))
    && DELETION_PRIMITIVES.test(withoutValidatedEventPrune({ ...source, content: withoutVerifiedScratchCleanup(source) }))).map(({ path }) => path);
}
function sources() { return gitVisibleFiles(["src"]).filter((path) => /\.tsx?$/u.test(path) && existsSync(join(REPO_ROOT, path))).map((path) => ({ path, content: readFileSync(join(REPO_ROOT, path), "utf8") })); }
describe("ledger projector retirement", () => {
  it("keeps current consumers absent and catches an injected read-through or repository alias", () => {
    assert.deepEqual(retiredLedgerConsumerViolations(sources()), []);
    for (const content of ['import { x } from "../infra/ledger/index.js";', 'db.authority.ledgerProjection.list()', 'db.authority.durableOutbox.get(id)', 'createLedgerReadThrough(root)']) assert.deepEqual(retiredLedgerConsumerViolations([{ path: "violating.ts", content }]), ["violating.ts"]);
  });
  it("allows no ledger appender or current cleanup path, with violating controls", () => {
    assert.deepEqual(ledgerSoleWriterViolations(sources()), []); assert.deepEqual(ledgerPruneReachabilityViolations(sources()), []);
    assert.deepEqual(ledgerSoleWriterViolations([{ path: "bad.ts", content: 'appendFileSync(ledgerFilePath(root), line)' }]), ["bad.ts"]);
    assert.deepEqual(ledgerPruneReachabilityViolations([{ path: "bad.ts", content: 'rmSync(ledgerDirectory(root))' }]), ["bad.ts"]);
    for (const primitive of ["unlinkSync", "unlink", "rmSync", "rmdirSync", "rmdir", "truncateSync", "ftruncateSync", "rimraf"]) {
      assert.deepEqual(ledgerPruneReachabilityViolations([{ path: "bad.ts", content: `${primitive}(\`\${root}/ledger/ucpath-2026-07-31.jsonl\`)` }]), ["bad.ts"]);
    }
    assert.deepEqual(ledgerSoleWriterViolations([{ path: "bad.ts", content: 'appendFileSync(`${root}/ledger/ucpath.jsonl`, line)' }]), ["bad.ts"]);
    const path = "src/backend/storage/events/timeline-import.ts";
    const content = readFileSync(join(REPO_ROOT, path), "utf8");
    for (const source of [{ path: "wrong.ts", content }, { path, content: content.replace("rmSync(temporary,", 'rmSync("ledger",') },
      { path, content: content + '\nrmSync("ledger");' }]) assert.deepEqual(ledgerPruneReachabilityViolations([source]), [source.path]);
  });
  it("has no retired tables or repositories on a fresh database", () => {
    const w = historyWorld(); try {
      w.commit(601); const db = new DatabaseSync(w.path, { readOnly: true }); try {
        const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
        for (const retired of ["operation_outbox", "ledger_partitions", "ledger_projections"]) assert.equal(names.includes(retired), false);
      } finally { db.close(); }
      for (const key of ["durableOutbox", "ledgerProjection"]) assert.equal(key in w.database.authority, false);
      assert.equal(w.history.query({ from: "2026-01-01", to: "2027-01-01" }).rows.length, 1);
    } finally { w.dispose(); }
  });
  it("preserves the separated historical line hash and detects changed content", () => {
    const line = canonicalJsonStringify({ seq: 0, payload: "historical" });
    assert.equal(deriveLedgerLineDigest(line), deriveLedgerLineDigest(line));
    assert.notEqual(deriveLedgerLineDigest(line), deriveLedgerLineDigest(`${line} `));
    assert.notEqual(deriveLedgerLineDigest(line), deriveLedgerLineDigest(canonicalJsonStringify({ seq: 1, payload: "historical" })));
  });
  it("retains historical dense-sequence refusal before allowing conversion", async () => {
    const w = historicalWorld({ files: true, sourceVersion: 39 }); try {
      const raw = new DatabaseSync(w.path); try { raw.exec("UPDATE ledger_partitions SET next_seq=5, version=version+1, record_json=json_set(record_json,'$.nextSeq',5,'$.version',2)"); } finally { raw.close(); }
      await assert.rejects(w.backup(), /ledger-partition-sequence-is-dense/u);
    } finally { w.dispose(); }
  });
  it("forbids changing retained historical operation source bytes", async () => {
    const w = historicalWorld(); try { await w.backup(); await w.upgrade(); const raw = new DatabaseSync(w.path); try {
      assert.throws(() => raw.exec("UPDATE timeline_operation_sources SET record_json=record_json"), /immutable/u);
      assert.throws(() => raw.exec("DELETE FROM timeline_operation_sources"), /deletion|tombstone|owned/u);
    } finally { raw.close(); } } finally { w.dispose(); }
  });
  it("retains this guard's inventory identity", () => { assert.equal(relative(REPO_ROOT, import.meta.filename), "tests/architecture/runs/ledger-projector.test.ts"); });
});

it("validates the complete prune target set before effects and preserves ledger bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "g-stream-prune-"));
  const clock = manualClock(new Date("2026-10-08T12:00:00Z"));
  const old = "fixture-2026-08-01.jsonl", recent = "fixture-2026-10-07.jsonl";
  try {
    for (const stream of ["spans", "notes", "ledger"]) { mkdirSync(join(root, stream)); writeFileSync(join(root, stream, old), `${stream}-old`); writeFileSync(join(root, stream, recent), `${stream}-recent`); }
    for (const invalid of ["ledger", "arbitrary", "../ledger", "notes/../ledger"]) {
      const input = JSON.parse(JSON.stringify({ stateRoot: root, streams: ["spans", invalid] })) as Parameters<typeof pruneEventStreams>[0];
      assert.throws(() => pruneEventStreams({ ...input, clock }));
      assert.throws(() => eventStreamDirectory(root, invalid as Parameters<typeof eventStreamDirectory>[1]));
      for (const stream of ["spans", "notes", "ledger"]) {
        assert.equal(readFileSync(join(root, stream, old), "utf8"), `${stream}-old`);
        assert.equal(readFileSync(join(root, stream, recent), "utf8"), `${stream}-recent`);
      }
    }
    const result = pruneEventStreams({ stateRoot: root, clock });
    assert.deepEqual([...result.removed].sort(), [join(root, "notes", old), join(root, "spans", old)].sort());
    for (const stream of ["spans", "notes"]) { assert.equal(existsSync(join(root, stream, old)), false); assert.equal(readFileSync(join(root, stream, recent), "utf8"), `${stream}-recent`); }
    assert.equal(readFileSync(join(root, "ledger", old), "utf8"), "ledger-old");
    assert.equal(readFileSync(join(root, "ledger", recent), "utf8"), "ledger-recent");
    const path = "src/backend/storage/events/jsonl-streams.ts", content = readFileSync(join(REPO_ROOT, path), "utf8");
    assert.deepEqual(ledgerPruneReachabilityViolations([{ path, content }]), []);
    for (const source of [
      { path: "src/backend/storage/events/unknown.ts", content },
      { path, content: content.replace('EventStreamSchema.parse(stream)', 'stream') },
      { path, content: content.replace('unlinkSync(file.path)', 'unlinkSync("ledger")') },
      { path, content: content.replace('path: join(directory, name)', 'path: join(stateRoot, "ledger", name)') },
      { path, content: content.replace('const directory = eventStreamDirectory(stateRoot, stream);\n  if (!existsSync(directory))', 'const directory = eventStreamDirectory(stateRoot, stream); directory = join(stateRoot, "ledger");\n  if (!existsSync(directory))') },
      { path, content: content.replace('return files.sort(', 'return [{ stream, workflow: "x", date: "2020-01-01", path: "ledger" }]; return files.sort(') },
      { path, content: content.replace('const streams = z.array(EventStreamSchema)', 'const EventStreamSchema = z.string(); const streams = z.array(EventStreamSchema)') },
      { path, content: content.replace('["spans", "notes"] as const', '["spans", "notes", "ledger"] as const') + '\n// export const EVENT_STREAMS = ["spans", "notes"] as const;' },
      { path, content: content.replace('const EventStreamSchema = z.enum(EVENT_STREAMS);', 'const EventStreamSchema = z.string(); // const EventStreamSchema = z.enum(EVENT_STREAMS);') },
      { path, content: content.replace('const STREAM_FILE_PATTERN = /^', 'const STREAM_FILE_PATTERN = /ledger|^') + '\n// const STREAM_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$/;' },
      { path, content: content + '\nEVENT_STREAMS.push("ledger");' },
      { path, content: content + '\nEventStreamSchema.parse = (value: unknown) => value;' },
      { path, content: content + '\nconst alias = EVENT_STREAMS; alias.push("ledger");' },
      { path, content: content + '\nObject.assign(EventStreamSchema, { parse: (value: unknown) => value });' },
      { path, content: content + '\nconst z = { enum: () => ({parse: (value: unknown) => value}) };' },
      { path, content: content + '\nunlinkSync("ledger");' },
      { path, content: content + '\nfunction unrelated() { unlinkSync("unknown"); }' },
    ]) assert.deepEqual(ledgerPruneReachabilityViolations([source]), [source.path], source.content.slice([...source.content].findIndex((character, index) => character !== content[index]), [...source.content].findIndex((character, index) => character !== content[index]) + 100));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
