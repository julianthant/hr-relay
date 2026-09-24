/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/demo-wire.ts (`fmtClock`,
 * `fmtElapsed`, `plural`) and demo-data.ts elapsed derivation.
 *
 * Display-only formatting (ref frontend-backend-integration §4, last row): elapsed time between server
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

/**
 * An interval in the operator's words.
 *
 * The NEGATIVE arm is drawn, not swallowed (D256). An elapsed can only come
 * out negative when the instant being measured from is in the FUTURE of the
 * clock measuring it, which is a defect in one of the two — and rendering it
 * as `0s`, which is what `elapsedSecondsBetween`'s old clamp did, spells that
 * defect as *"this just started"*. The Track C proof read exactly that: a run
 * that had been parked for over two minutes showed `0s`, because the page's
 * frozen clock predated it (separations §9.22 item 2). A sub-second skew still
 * renders `0s` on its own — `Math.round` of a fraction of a second is zero —
 * so this arm only appears when something is genuinely wrong.
 */
export function fmtElapsed(sec: number): string {
  if (sec < 0) return `-${fmtElapsed(-sec)}`;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

/**
 * Whole seconds between two served instants — SIGNED; throws on an
 * unparseable one.
 *
 * It used to clamp at zero, which made "the clock reading this is behind the
 * fact it is reading" indistinguishable from "this happened just now". Those
 * are different facts and this program does not let a wrong one wear a right
 * one's shape (D256).
 */
export function elapsedSecondsBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from)) throw new Error(`elapsedSecondsBetween: not an ISO instant: ${fromIso}`);
  if (Number.isNaN(to)) throw new Error(`elapsedSecondsBetween: not an ISO instant: ${toIso}`);
  return Math.round((to - from) / 1000);
}

/**
 * THE queue row's one time fact, chosen by what the run actually is (D124).
 *
 * Three shapes, and none of them guesses:
 * - a run that has not started shows nothing;
 * - a run still in flight shows live elapsed against `now`;
 * - a SETTLED run shows its bare duration — `endedAt − startedAt`, both served
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
    // Bare, like the demo's `row.duration`: the operator ruled the number
    // stands alone (2026-09-01). What keeps it from a live elapsed is the row's
    // terminal status beside it, not a word in front of it.
    return { text: fmtElapsed(elapsedSecondsBetween(surface.startedAt, surface.endedAt.value)) };
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
/**
 * `2026-08-03` → `Mon, Aug 3` — the day, in the operator's short form.
 *
 * It lives HERE rather than in `top-bar.tsx` because two surfaces read it: the
 * date navigator, and the queue's empty state, which printed a raw ISO day
 * (`No Person Lookup runs on 2026-08-14`) where the demo prints the same short
 * form its own header carries (R3 f.2). A second copy in the queue was the
 * other option and is exactly how one surface comes to say `Aug 3` while its
 * neighbour says `August 3rd`.
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `demo-days.ts` `dayLabel` / `demo-wire.ts` `fmtDayLabel`.
 */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * An INSTANT as the operator's local calendar day — `Thu, Aug 13`.
 *
 * `fmtClock` is the wrong instrument for a date weeks out (it prints a time of
 * day and nothing else), and `dayLabel` reads a `YYYY-MM-DD` partition in UTC.
 * A retention purge instant is neither: it is a real instant whose meaning is
 * "the day this becomes eligible", and the sweep that acts on it partitions by
 * LOCAL date, so this reads it locally to match.
 */
export function fmtInstantDay(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`fmtInstantDay: not an ISO instant: ${iso}`);
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The NOUN alone, agreeing with a count printed elsewhere in the sentence —
 * `3 bound ${pluralize(3, "column")}`, where the adjective sits between the two
 * and `plural` cannot be used.
 *
 * It was a second private `plural` inside `intake.tsx` with the same name and a
 * different return, which is the worst shape a fork can take: a call site moving
 * between the two files compiles and prints a count twice or not at all.
 */
export function pluralize(n: number, noun: string, pluralNoun?: string): string {
  return n === 1 ? noun : pluralNoun ?? `${noun}s`;
}

/** The count and the noun together — `3 columns`. */
export function plural(n: number, noun: string, pluralNoun?: string): string {
  return `${n} ${pluralize(n, noun, pluralNoun)}`;
}

/**
 * An opaque durable identifier cut for the eye — a manifest id, a plan id, a
 * receipt id, a fingerprint. The full value always stays reachable beside it
 * (a title, a ⓘ, the detail panel); this is the chip length, in ONE place, so
 * two surfaces cannot show the same id at two lengths.
 */
export const SHORT_HASH_PREFIX = 8;

export function shortHash(value: string): string {
  return value.slice(0, SHORT_HASH_PREFIX);
}

/**
 * A descriptor version as the operator reads it — `v3`.
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `demo-wire.ts:1773` `fmtVersionTag`, which prints `v{major}.{minor}` because
 * the demo's descriptors carry a pair. This tree's do not:
 * `defineWorkflowDescriptor` admits ONE positive integer (`src/base/workflow.ts`
 * — *"version must be a positive integer"*), and the run envelope, the
 * checkpoint rows and the archive's `descriptorVersion` all record that single
 * number. So the tag is `v{n}` and a `.0` is never appended — a digit nobody
 * records, printed on the last screen before a real HR transaction starts, is
 * the fabricated constant this tree bans.
 *
 * Every place a version is shown to the operator composes it here. `archive.tsx`
 * builds the identical string inline for its row-token tooltip; it is the same
 * shape by construction and should adopt this function when that file is next
 * touched.
 */
export function versionTag(version: number): string {
  return `v${String(version)}`;
}

/**
 * The APP's version tag — `app 0.1` (D272 item 4, ledger row A126).
 *
 * The bootstrap serves a semver (`AppVersionSchema`), and the shell drew all
 * three components under a tooltip that explains exactly two: what MAJOR does
 * to prior-version runs and what MINOR does not. A third digit the sentence
 * beside it never mentions is a claim the operator cannot check, so the tag is
 * the demo's MAJOR.MINOR and the patch stays where it is served.
 *
 * It THROWS on anything that is not `major.minor[.…]`. This is the one place
 * the app's own version reaches the screen, and a version tag that quietly
 * degrades to the raw string when the shape moves is a wrong version drawn
 * beside a right-sounding sentence.
 */
export function fmtAppVersion(appVersion: string): string {
  const parts = appVersion.split(".");
  const [major, minor] = parts;
  if (
    parts.length < 2
    || major === undefined
    || minor === undefined
    || !/^\d+$/u.test(major)
    || !/^\d+$/u.test(minor)
  ) {
    throw new Error(
      `app version "${appVersion}" is not MAJOR.MINOR[.PATCH]; the shell's version tag prints the `
      + "first two components and will not guess at a shape it does not recognise",
    );
  }
  return `${major}.${minor}`;
}

/** `app 0.1` — where the number needs to say WHICH version it is. */
export function appVersionTag(appVersion: string): string {
  return `app ${fmtAppVersion(appVersion)}`;
}
