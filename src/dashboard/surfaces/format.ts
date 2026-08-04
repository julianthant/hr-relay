/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-wire.ts (`fmtClock`,
 * `fmtElapsed`, `plural`) and demo-data.ts elapsed derivation.
 *
 * Display-only formatting (doc 13 §4, last row): elapsed time between server
 * timestamps is presentation; terminal durations remain server facts. Nothing
 * here decides anything.
 */

/**
 * A served ISO instant as the operator's wall clock (`3:07 PM`).
 *
 * DEVIATION from the demo's implementation, on purpose: the demo regex-sliced
 * the hour out of fixture instants that were authored in local time. The real
 * wire serves UTC instants, so slicing would print UTC on a Pacific operator's
 * screen — a wrong clock reading on a trust surface. An unparseable instant is
 * a wire defect and throws with the value named.
 */
export function fmtClock(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fmtClock: not an ISO instant: ${iso}`);
  const date = new Date(ms);
  const h = date.getHours();
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(date.getMinutes()).padStart(2, "0")} ${suffix}`;
}

export function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/** Whole seconds between two served instants; throws on an unparseable one. */
export function elapsedSecondsBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from)) throw new Error(`elapsedSecondsBetween: not an ISO instant: ${fromIso}`);
  if (Number.isNaN(to)) throw new Error(`elapsedSecondsBetween: not an ISO instant: ${toIso}`);
  return Math.max(0, Math.round((to - from) / 1000));
}

/**
 * THE queue row's one time fact, chosen by what the run actually is (D124).
 *
 * Three shapes, and none of them guesses:
 * - a run that has not started shows nothing;
 * - a run still in flight shows live elapsed against `now`;
 * - a SETTLED run shows `took <duration>` — `endedAt − startedAt`, both served
 *   instants — because `now − startedAt` answers a question nobody asks of a
 *   finished run and grows forever. The live exit run displayed **2h 47m** for
 *   ~14.5 minutes of execution, which is the defect this closes.
 *
 * A terminal row whose `endedAt` the server could not serve renders an
 * explicit `duration unknown` carrying the server's own reason. It never
 * substitutes `now`: "we do not know when it ended" and "it ended just now"
 * are different facts and must not render as the same number.
 */
export function runTiming(
  surface: {
    readonly status: string;
    readonly startedAt: string;
    readonly endedAt: { readonly state: "present"; readonly value: string }
    | { readonly state: "absent"; readonly reason: string };
  },
  nowIso: string,
  isTerminalStatus: (status: string) => boolean,
): { text: string; title?: string } | undefined {
  if (surface.status === "queued") return undefined;
  if (surface.endedAt.state === "present") {
    return { text: `took ${fmtElapsed(elapsedSecondsBetween(surface.startedAt, surface.endedAt.value))}` };
  }
  if (isTerminalStatus(surface.status)) {
    return { text: "duration unknown", title: surface.endedAt.reason };
  }
  return { text: fmtElapsed(elapsedSecondsBetween(surface.startedAt, nowIso)) };
}

/**
 * `n` with its noun, pluralised — a template literal is the easiest place to
 * write a number beside a word that does not agree with it.
 */
export function plural(n: number, noun: string, pluralNoun?: string): string {
  return `${n} ${n === 1 ? noun : pluralNoun ?? `${noun}s`}`;
}
