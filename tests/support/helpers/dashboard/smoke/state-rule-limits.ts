/** The data the state rules read: rule names, word limits and banned text. Change a limit or a word here only. */

export const STATE_RULE_NAMES = [
  "fits-viewport",
  "no-banned-text",
  "word-limits",
  "toast-text-only",
  "toast-placement",
  "skeleton-only-while-fetching",
  "dialogs-share-shape",
  "primary-button-accent",
  "no-dead-disabled-control",
  "named-and-focusable",
  "declared-diagnostics",
] as const;
export type StateRuleName = typeof STATE_RULE_NAMES[number];

/** The most words a title, a description and an error may hold. */
export const WORD_LIMITS = {
  title: { limit: 8, selector: 'h1, h2, h3, [data-slot$="title"]' },
  description: { limit: 20, selector: '[data-slot$="description"]' },
  error: { limit: 16, selector: '[role="alert"], [data-slot="failure-notice"]' },
} as const;

/** Phrases an operator must never read, matched whole and without regard to case. */
export const BANNED_PHRASES = ["outcome is uncertain", "Check outcome"] as const;

/** Internal vocabulary, matched as whole words without regard to case. */
export const BANNED_TERMS = ["command", "outcome", "authority", "projection", "envelope", "fingerprint", "revision", "executor", "wire"] as const;

/** Raw codes, paths and ids. */
export const BANNED_PATTERNS = [
  { name: "raw code", pattern: /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/u },
  { name: "raw id", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu },
  { name: "file path", pattern: /(?:^|[\s"'(])(?:~|\.{1,2}|[A-Za-z]:)?[\\/](?:[\w.-]+[\\/])+[\w.-]+/u },
] as const;
