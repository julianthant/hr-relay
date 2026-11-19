import { readFileSync } from "node:fs";
import ts from "typescript";
import { gitVisibleFiles, REPO_ROOT } from "../../support/helpers/guard-files.js";

export const DASHBOARD_ROOTS = ["src/dashboard/surfaces", "src/dashboard/app"] as const;
export const DASHBOARD_ALL = "src/dashboard";
export const TYPE_SCALE_PX: readonly number[] = [10, 11, 12, 13, 14, 16, 20, 27];
export const FONT_WEIGHTS: readonly number[] = [400, 500, 600];
export const THEME_DIR = "src/dashboard/ds/theme/";
export const DATE_FORMAT_FILE = "src/dashboard/lib/date-format.ts";
export const TIME_AND_ID_ROOTS = ["src/dashboard/surfaces/run-detail/logs", "src/dashboard/surfaces/queue"] as const;

/** One exception that stays: the file, the exact text matched and why it must. */
export interface KeptException {
  readonly file: string;
  readonly match: string;
  readonly reason: string;
}

export type RuleScan = (path: string, text: string) => readonly string[];

const stripCssComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
const stripJsComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`\\])\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, " "));
const isCss = (path: string): boolean => path.endsWith(".css");
const isScript = (path: string): boolean => /\.(ts|tsx)$/.test(path);
const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

function sourceOf(path: string, text: string): string {
  return isCss(path) ? stripCssComments(text) : isScript(path) ? stripJsComments(text) : text;
}

function matches(path: string, text: string, pattern: RegExp, message: (found: RegExpExecArray) => string | undefined): string[] {
  const source = sourceOf(path, text);
  const out: string[] = [];
  for (const found of source.matchAll(pattern)) {
    const said = message(found);
    if (said !== undefined) out.push(`${path}:${lineOf(source, found.index ?? 0)}: ${said} [${found[0].trim()}]`);
  }
  return out;
}

const WEIGHT_WORDS: Readonly<Record<string, number>> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };

export const fontWeightViolations: RuleScan = (path, text) => {
  const say = (value: string): string | undefined => {
    const weight = /^\d+$/.test(value) ? Number(value) : WEIGHT_WORDS[value];
    if (weight === undefined) return value === "inherit" || value === "initial" || value === "unset" ? undefined : `unknown font weight ${value}`;
    return FONT_WEIGHTS.includes(weight) ? undefined : `font weight ${value} is outside 400/500/600; use font-normal, font-medium or font-semibold (dsText)`;
  };
  return [
    ...matches(path, text, /font-weight\s*:\s*([\w-]+)/g, (found) => say(found[1])),
    ...matches(path, text, /\bfont-\[(\d+)\]/g, (found) => say(found[1])),
    ...matches(path, text, /(?<![\w-])font-(thin|extralight|light|bold|extrabold|black)\b(?!-)/g, (found) => say(found[1])),
    ...matches(path, text, /\bfontWeight\s*:\s*["']?([\w-]+)/g, (found) => say(found[1])),
  ];
};

export const fontSizeViolations: RuleScan = (path, text) => {
  const say = (value: string): string | undefined =>
    TYPE_SCALE_PX.includes(Number(value)) ? undefined : `font size ${value}px is outside the type scale ${TYPE_SCALE_PX.join("/")}; use a dsText step or a --ds-text-* token`;
  return [
    ...matches(path, text, /font-size\s*:\s*([\d.]+)px/g, (found) => say(found[1])),
    ...matches(path, text, /\btext-\[([\d.]+)px\]/g, (found) => say(found[1])),
    ...matches(path, text, /\bfontSize\s*:\s*["']?([\d.]+)(?:px)?["']?/g, (found) => say(found[1])),
  ];
};

export const fractionalPxViolations: RuleScan = (path, text) =>
  matches(path, text, /(?<![\w.])-?\d*\.\d+px\b/g, () => "fractional px value; use a whole px value or a --ds-* token");

export const rawHexViolations: RuleScan = (path, text) =>
  path.startsWith(THEME_DIR) ? [] : matches(path, text, /(?<![\w&#-])#([0-9a-fA-F]{3,8})\b/g, (found) =>
    [3, 4, 6, 8].includes(found[1].length) ? "raw hex colour; define it in ds/theme and use its var(--ds-*) or var(--ui-*) token" : undefined);

export const dateFormatterViolations: RuleScan = (path, text) =>
  path === DATE_FORMAT_FILE ? [] : matches(path, text, /Intl\.DateTimeFormat|\.toLocale(?:Date|Time)?String\b/g, () => "date or time formatted outside lib/date-format.ts; call formatCalendarDate, formatInstantDate or its sibling there");

export const bespokeControlViolations: RuleScan = (path, text) =>
  isCss(path) ? matches(path, text, /\.(btn|hub-btn|hub-modal|hub-field)(?![\w-])/g, (found) => `.${found[1]} rule; use the ds Button, Dialog or Input primitive instead of a bespoke control`) : [];

export const monoTimeAndIdViolations: RuleScan = (path, text) =>
  matches(path, text, /\bfont-(?:mono|data)\b|--(?:ds-)?font-(?:mono|data)\b/g, () => "monospace on a time or id; times and ids use the body face with dsText nums");

/** Class names a stylesheet selects, with the line of each. */
export function cssClassSelectors(text: string): readonly { readonly name: string; readonly line: number }[] {
  const source = stripCssComments(text);
  const found: { name: string; line: number }[] = [];
  const stripped = source.replace(/"[^"]*"|'[^']*'|url\([^)]*\)/g, (part) => part.replace(/[^\n]/g, " "));
  for (const rule of stripped.matchAll(/([^{}]+)\{/g)) {
    const head = rule[1];
    if (/^\s*@(?!media|supports|container|layer)/.test(head) || /^\s*[\d.%]+\s*(,|$)|^\s*(from|to)\b/.test(head)) continue;
    for (const selector of head.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      const at = (rule.index ?? 0) + (selector.index ?? 0);
      if (/\d$/.test(stripped.slice(Math.max(0, at - 1), at))) continue;
      found.push({ name: selector[1], line: lineOf(stripped, at) });
    }
  }
  return found;
}

/** Selectors in `css` whose class no script or markup in `references` mentions as a whole token. */
export function unreferencedClasses(path: string, css: string, references: string): readonly string[] {
  const tokens = new Set(references.match(/-?[_a-zA-Z][\w-]*/g));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { name, line } of cssClassSelectors(css)) {
    if (seen.has(name) || tokens.has(name)) continue;
    seen.add(name);
    out.push(`${path}:${line}: .${name} is selected here and no .ts, .tsx or .html names it; delete the rule or use the class`);
  }
  return out;
}

const CLICKABLE_NATIVE = new Set(["button", "a", "input", "select", "textarea", "summary", "label", "option", "form"]);

/** An onClick on a lowercase non-interactive element with no role and no key handler is unreachable by keyboard. */
export function keyboardUnreachableClicks(path: string, text: string): readonly string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const names = new Set(node.attributes.properties.flatMap((attribute) => ts.isJsxAttribute(attribute) ? [attribute.name.getText(source)] : []));
      if (/^[a-z]/.test(tag) && !CLICKABLE_NATIVE.has(tag) && names.has("onClick") && !(names.has("role") && names.has("tabIndex") && names.has("onKeyDown"))) {
        out.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: <${tag}> has onClick but is not a button; use a ds Button or BareButton so Tab reaches it`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

export function dashboardFiles(roots: readonly string[], extensions: readonly string[]): readonly string[] {
  return gitVisibleFiles([...roots]).filter((path) => extensions.some((extension) => path.endsWith(extension)));
}

export const readRepoFile = (path: string): string => readFileSync(`${REPO_ROOT}/${path}`, "utf8");

/** Violations minus the kept exceptions; a kept exception that matches nothing is stale and fails. */
export function applyExceptions(violations: readonly string[], kept: readonly KeptException[]): readonly string[] {
  const used = new Set<KeptException>();
  const remaining = violations.filter((violation) => {
    const keeper = kept.find((entry) => violation.startsWith(`${entry.file}:`) && violation.includes(`[${entry.match}]`));
    if (keeper === undefined) return true;
    used.add(keeper);
    return false;
  });
  const stale = kept.filter((entry) => !used.has(entry)).map((entry) => `stale exception ${entry.file} [${entry.match}]: no violation left, delete the entry`);
  const unreasoned = kept.filter((entry) => entry.reason.trim().length < 12).map((entry) => `exception ${entry.file} [${entry.match}] needs a reason`);
  return [...remaining, ...stale, ...unreasoned];
}
