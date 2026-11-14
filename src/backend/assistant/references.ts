/** Opaque `[[K<n>.g<generation>]]` references: the model sees tokens, never the personal values behind them. */
export type AssistantReferenceKind = "P" | "E" | "R" | "N" | "S" | "A" | "T" | "V";
export interface AssistantReferenceEntry {
  readonly kind: AssistantReferenceKind;
  readonly target: string;
  /** Operator-facing text the server substitutes for the token in an answer. */
  readonly display: string;
  /** Text a tool argument becomes when it names this reference (an EID's digits, a person's name). */
  readonly expand: string;
  /** The exact row revision this reference was issued for, when the reference pins one (the selected run). */
  readonly version?: number;
}
export class AssistantReferenceError extends Error {
  constructor(readonly reason: "reference-unknown" | "reference-expired" | "reference-kind" | "reference-limit") { super(reason); this.name = "AssistantReferenceError"; }
}

const TOKEN = /\[\[([PERNSATV])([1-9][0-9]{0,3})\.g([1-9][0-9]{0,8})\]\]/gu;
const TOKEN_SHAPED = /\[\[[A-Za-z][0-9]+\.g[0-9]+\]\]/gu;
const EXACT_TOKEN = /^\[\[([PERNSATV])([1-9][0-9]{0,3})\.g([1-9][0-9]{0,8})\]\]$/u;
const MAX_ENTRIES = 500;

export function createAssistantReferenceTable(generation: number) {
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("assistant-reference-generation-invalid");
  const entries = new Map<string, AssistantReferenceEntry>(), byTarget = new Map<string, string>();
  const counters = new Map<AssistantReferenceKind, number>();
  function issue(kind: AssistantReferenceKind, target: string, display: string, expand: string = display, version?: number): string {
    const key = `${kind}:${target}:${String(version ?? "")}`, existing = byTarget.get(key);
    if (existing !== undefined) return existing;
    if (entries.size >= MAX_ENTRIES) throw new AssistantReferenceError("reference-limit");
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const token = `[[${kind}${String(n)}.g${String(generation)}]]`;
    entries.set(token, Object.freeze({ kind, target, display, expand, ...(version === undefined ? {} : { version }) }));
    byTarget.set(key, token);
    return token;
  }
  function resolve(token: string, kinds: readonly AssistantReferenceKind[]): AssistantReferenceEntry {
    const match = EXACT_TOKEN.exec(token.trim());
    if (match === null) throw new AssistantReferenceError("reference-unknown");
    if (Number(match[3]) !== generation) throw new AssistantReferenceError("reference-expired");
    const entry = entries.get(token.trim());
    if (entry === undefined) throw new AssistantReferenceError("reference-unknown");
    if (!kinds.includes(entry.kind)) throw new AssistantReferenceError("reference-kind");
    return entry;
  }
  /** Replaces this generation's issued tokens; any other token text stays as written. */
  function replace(text: string, pick: (entry: AssistantReferenceEntry) => string): string {
    return text.replace(TOKEN, (whole, _kind: string, _n: string, tokenGeneration: string) => {
      const entry = Number(tokenGeneration) === generation ? entries.get(whole) : undefined;
      return entry === undefined ? whole : pick(entry);
    });
  }
  return Object.freeze({
    generation, issue, resolve,
    /** Strict segments for server reply construction; literal wording has no markup authority. */
    segments(text: string): ({ kind: "text"; text: string } | { kind: "reference"; token: string; entry: AssistantReferenceEntry })[] {
      const segments: ({ kind: "text"; text: string } | { kind: "reference"; token: string; entry: AssistantReferenceEntry })[] = [];
      let at = 0;
      for (const match of text.matchAll(TOKEN_SHAPED)) {
        if (match.index > at) segments.push({ kind: "text", text: text.slice(at, match.index) });
        segments.push({ kind: "reference", token: match[0], entry: resolve(match[0], ["P", "E", "R", "N", "S", "A", "T", "V"]) });
        at = match.index + match[0].length;
      }
      if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
      return segments;
    },
    display: (text: string) => replace(text, entry => entry.display),
    /** A tool argument with every token-shaped part resolved strictly; an unknown, expired or wrong-kind reference refuses. */
    expandArgument: (text: string, kinds: readonly AssistantReferenceKind[]) => text.replace(TOKEN_SHAPED, token => resolve(token, kinds).expand),
  });
}
export type AssistantReferenceTable = ReturnType<typeof createAssistantReferenceTable>;

const CONVERSATION_LIMIT = 20;
/** One table per conversation per process; a new owner or a new process starts a strictly later generation. */
export function createAssistantReferences() {
  const tables = new Map<string, { owner: string; table: AssistantReferenceTable }>();
  return Object.freeze({
    table(conversationId: string, owner: Readonly<{ profileId: string; epoch: number }>, generation: number): AssistantReferenceTable {
      const key = `${owner.profileId}:${String(owner.epoch)}`, current = tables.get(conversationId);
      if (current !== undefined && current.owner === key) return current.table;
      tables.delete(conversationId);
      while (tables.size >= CONVERSATION_LIMIT) tables.delete(tables.keys().next().value as string);
      const table = createAssistantReferenceTable(generation);
      tables.set(conversationId, { owner: key, table });
      return table;
    },
    clear(conversationId: string) { tables.delete(conversationId); },
  });
}

// Order matters: an earlier alternative wins at the same position, so UUIDs and emails are never split into digit runs.
const MASK = new RegExp([
  /(?<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/u.source,
  /(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/u.source,
  /(?<ssn>(?<!\d)\d{3}-\d{2}-\d{4}(?!\d))/u.source,
  /(?<phone>(?<![\d+])(?:\+?1[ .-]?)?(?:\(\d{3}\) ?|\d{3}[ .-])\d{3}[ .-]\d{4}(?!\d))/u.source,
  /(?<digits>(?<!\d)\d+(?!\d))/u.source,
].join("|"), "giu");

/** Model text for one operator message: typed token brackets neutralized, EIDs as `E` references, other identifiers as fixed markers. */
export function maskOperatorText(text: string, table: AssistantReferenceTable): string {
  return text.replaceAll("[[", "[ [").replaceAll("]]", "] ]").replace(MASK, (whole, ...rest: unknown[]) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (groups.uuid !== undefined) return whole;
    if (groups.email !== undefined) return "[redacted email]";
    if (groups.ssn !== undefined) return "[redacted SSN]";
    if (groups.phone !== undefined) return "[redacted phone]";
    if (whole.length === 8) return table.issue("E", whole, whole);
    if (whole.length === 9) return "[redacted SSN]";
    if (whole.length >= 10) return "[redacted number]";
    return whole;
  });
}
