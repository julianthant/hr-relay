import { isAbsolute, relative, sep } from "node:path";

/**
 * Lexical containment: `child` is `parent` or lies beneath it. Callers add their own same-root rule, realpath and authority checks.
 * `refuseBackslashParent` also treats a leading `..\` as an escape on every platform, which runtime admission requires.
 */
export function lexicallyWithin(parent: string, child: string, options: { refuseBackslashParent?: boolean } = {}): boolean {
  const part = relative(parent, child);
  if (options.refuseBackslashParent === true && part.startsWith("..\\")) return false;
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}
