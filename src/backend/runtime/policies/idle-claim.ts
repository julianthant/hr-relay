export type IdleClaimDecision = { readonly kind: "exit" } | { readonly kind: "wait"; readonly delayMs: number };

type IdleClaimInput =
  | Readonly<{ exitWhenIdle: true; notBefore?: string }>
  | Readonly<{ exitWhenIdle: false; cadenceMs: number; notBefore?: undefined }>
  | Readonly<{ exitWhenIdle: false; cadenceMs: number; notBefore: string; nowMs: number }>;

export function decideIdleClaim(input: IdleClaimInput): IdleClaimDecision {
  if (input.exitWhenIdle) return { kind: "exit" };
  if (input.notBefore === undefined) return { kind: "wait", delayMs: input.cadenceMs };
  const untilMs = Math.max(0, Date.parse(input.notBefore) - input.nowMs);
  return { kind: "wait", delayMs: Math.min(untilMs, input.cadenceMs) };
}
