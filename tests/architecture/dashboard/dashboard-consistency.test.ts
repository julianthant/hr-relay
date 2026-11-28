// Consistency rules: one failure notice, three dialog widths. A TypeScript scan of every dashboard TSX file.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import ts from "typescript";
import { dashboardFiles, readRepoFile, DASHBOARD_ROOTS } from "./helpers/design-rules.js";

const DIALOG_SIZES = new Set(["sm", "md", "lg"]);
/** Picks warning and info tones from a worker's state; a failure never reaches it. */
const DYNAMIC_TONE_FILES = new Set(["src/dashboard/app/loaded-app.tsx"]);

export function consistencyViolations(path: string, text: string): readonly string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attr = (name: string) => node.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(source) === name)?.initializer?.getText(source);
      const where = `${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
      const tone = attr("tone");
      if ((tag === "Banner" || tag === "Notice") && tone !== undefined) {
        if (/["'`]danger["'`]/u.test(tone)) out.push(`${where}: <${tag}> shows a danger tone; use FailureNotice`);
        else if (tone.startsWith("{") && !DYNAMIC_TONE_FILES.has(path)) out.push(`${where}: <${tag}> picks its tone from an expression; branch to FailureNotice for a failure`);
      }
      if (tag === "DialogContent") {
        const size = /^\{?["']([^"']*)["']\}?$/u.exec(attr("size") ?? "")?.[1];
        if (size !== undefined && !DIALOG_SIZES.has(size)) out.push(`${where}: dialog size "${size}"; use sm, md or lg`);
        if (/\b(max-w-|w-\[)/u.test(attr("className") ?? "")) out.push(`${where}: dialog width override; use the size's shared width`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const BAD = `export const a = <><Banner tone='danger' title="x" /><Notice tone={ok ? "warning" : "danger"} title="y" /><Notice tone={t} title="z" />
  <DialogContent size="xl" onEscapeKeyDown={event => { event.preventDefault(); }} className="w-[min(1200px,100vw)] max-w-none" title="d" /></>;`;
const GOOD = `export const a = <><Notice tone="warning" title="x" /><FailureNotice sentence="y." /><DialogContent size="lg" onEscapeKeyDown={event => { event.preventDefault(); }} className="h-[800px]" title="d" /></>;`;

describe("dashboard consistency", () => {
  it("passes the clean fixture and fails the violating one", () => {
    assert.deepEqual(consistencyViolations("good.tsx", GOOD), []);
    assert.equal(consistencyViolations("bad.tsx", BAD).length, 5);
  });
  it("shows errors with FailureNotice, keeps tones literal and dialogs at sm, md or lg widths", () => {
    const files = dashboardFiles(DASHBOARD_ROOTS, [".tsx"]);
    assert.ok(files.length > 0);
    assert.deepEqual(files.flatMap(path => consistencyViolations(path, readRepoFile(path))), []);
  });
  it("offers only the sm, md and lg dialog sizes, with no viewer width override", () => {
    assert.match(readRepoFile("src/dashboard/ds/primitives/primitives-overlay.tsx"), /DsDialogSize = "sm" \| "md" \| "lg";/u);
    assert.doesNotMatch(readRepoFile("src/dashboard/surfaces/run-detail/logs/log-presentation.css"), /\.log-viewer-dialog\s*\{[^}]*\b(max-)?width\s*:/u);
  });
});
