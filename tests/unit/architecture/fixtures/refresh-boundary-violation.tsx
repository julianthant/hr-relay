/**
 * Violating fixture for `dashboard-refresh-boundary.test.ts` — a surface that
 * exports every kind of non-component value beside its component. Each export
 * below is ONE way a surface stops being a Fast Refresh boundary; the guard
 * must name all of them.
 */
import { useState, type ReactElement } from "react";

/** an exported hook — a new function reference every re-evaluation */
export function useThing(): number {
  const [n] = useState(0);
  return n;
}

/** an exported helper — same failure, lowercase name */
export function helper(): string {
  return "x";
}

/** an exported object constant — uppercase, still a fresh reference */
export const TONE: Record<string, string> = { a: "b" };

/** an exported array constant */
export const KINDS: readonly string[] = ["a"];

function reexported(): string {
  return "y";
}

/** the component itself is fine */
export function Surface(): ReactElement {
  return <div>{helper()}</div>;
}

export { reexported };
