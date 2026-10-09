
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
