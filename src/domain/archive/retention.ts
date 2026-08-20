/**
 * What happens to an archived run's data, and WHEN — ref dashboard-surfaces §10.4's retention
 * policy (D86) rendered as computed instants per record rather than as prose
 * the surface would then be free to get wrong.
 *
 * The policy has four halves and they do NOT share a shape:
 *
 * - **the archived row** — schema v13 aborts UPDATE and DELETE on
 *   `archived_runs` in SQL, so nothing purges it, ever;
 * - **`notes/` and `spans/`** — the JSONL this run's log lines and timeline
 *   were folded from prune at 30 days BY FILE DATE, so this is the one half
 *   that has an instant to name;
 * - **evidence** (the content-addressed capture bytes and the checkpoint rows
 *   the pointers name) — retained "until purge", which is an operator ACT
 *   (`cli purge-run`) and not a schedule, so there is no instant and saying
 *   "never" would be a different lie;
 * - **the ledger** — never archived, never pruned (ref dashboard-surfaces §2.1 D21).
 *
 * Four outcomes, four arms. Collapsing "nothing will ever purge this" into
 * "no date is scheduled" would let the Retention card tell an operator their
 * screenshots are safe forever when a single command removes them.
 *
 * Everything here is a pure function of the archived record's own fields plus
 * the policy constants plus `now`. That is deliberate and load-bearing:
 * `buildArchivedRunDetail` resolves NOTHING outside the archive tables (ref dashboard-surfaces
 * §10.2, proved by reading a record back with the registry emptied), so a
 * retention block that read the artifact store back would break the one
 * property the archive exists to have.
 */
import { z } from "zod";
import { localDatePart } from "../clock.js";
import { IsoInstantSchema } from "../ids.js";

/**
 * D86 (ref dashboard-surfaces §2.1 / §10.4): `notes/` and `spans/` both prune at 30 days.
 * `pruneEventStreams` is the implementation and imports this constant, so the
 * date this module computes and the date that sweep acts on are one number.
 */
export const EVENT_STREAM_RETENTION_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * What will happen to one class of a run's data.
 *
 * `basis` rides the three SETTLED arms rather than only the refusal, because a
 * date with no derivation beside it is a number an operator cannot check;
 * `reason` rides `unknown` because an absence must name what it is missing.
 */
export const RetentionOutlookSchema = z.discriminatedUnion("state", [
  /** A sweep purges it, and this is the earliest instant it can. */
  z.strictObject({
    state: z.literal("scheduled"),
    purgeAt: IsoInstantSchema,
    basis: z.string().min(1),
  }),
  /** Nothing purges it. Not a schedule that is far away — no schedule at all. */
  z.strictObject({ state: z.literal("permanent"), basis: z.string().min(1) }),
  /** Only an explicit operator act removes it; there is no instant to name. */
  z.strictObject({ state: z.literal("on-request"), basis: z.string().min(1) }),
  /** The instant genuinely cannot be computed from what this record holds. */
  z.strictObject({ state: z.literal("unknown"), reason: z.string().min(1) }),
]);
export type RetentionOutlook = z.infer<typeof RetentionOutlookSchema>;

/**
 * The retention block one archived run carries. `pointers` is the demo's
 * "N of M still retained" count, and its `basis` states the DERIVATION rather
 * than claiming an observation: nothing here reads a byte back.
 */
export const ArchiveRetentionWireSchema = z.strictObject({
  computedAt: IsoInstantSchema,
  /** The archived record itself — ref dashboard-surfaces §10.2's audit copy. */
  row: RetentionOutlookSchema,
  /** `notes/` + `spans/`: this run's log lines and its timeline. */
  eventStreams: RetentionOutlookSchema,
  /** The captured bytes and checkpoint rows the evidence pointers name. */
  evidence: RetentionOutlookSchema,
  /** The write ledger — what was filed in a real HR system. */
  ledger: RetentionOutlookSchema,
  pointers: z.strictObject({
    total: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
    basis: z.string().min(1),
  }),
}).superRefine((retention, context) => {
  if (retention.pointers.retained > retention.pointers.total) {
    context.addIssue({
      code: "custom",
      path: ["pointers", "retained"],
      message: "more evidence pointers are retained than this record names",
    });
  }
});
export type ArchiveRetentionWire = z.infer<typeof ArchiveRetentionWireSchema>;

/**
 * The earliest instant `pruneEventStreams` can delete a partition dated
 * `localDate`.
 *
 * The sweep removes a file when `file.date < localDatePart(now - 30d)`, so a
 * partition survives the whole of its 30th day and goes on the first sweep of
 * the LOCAL day after that. The instant returned is the start of that local
 * day — the earliest moment the file becomes eligible, which is the honest
 * bound. It is a bound and not a promise: the sweep runs at dashboard boot
 * (`src/server/dashboard/compose.ts`), so the file survives until the next
 * boot on or after it, and `basis` says so.
 */
export function eventStreamPurgeInstant(localDate: string, retentionDays: number): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (parsed === null) throw new Error(`${localDate} is not a local partition date`);
  const day = new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]));
  if (Number.isNaN(day.getTime())) throw new Error(`${localDate} is not a real calendar date`);
  // +1 day past the retention window: the file is eligible once the cutoff
  // date has moved strictly PAST its own date, never on the boundary day.
  return new Date(day.getTime() + (retentionDays + 1) * MILLISECONDS_PER_DAY).toISOString();
}

/*
 * NOT exported: this is one pure function's argument, not a boundary. Every
 * value in it is already schema-bound by the archived record it is read off,
 * and exporting it would claim a contract nothing crosses.
 */
interface ArchiveRetentionInput {
  /** When this block was computed — the surface renders relative to it. */
  readonly now: string;
  /**
   * The run's own end instant, or the reason the row carries none. A run with
   * no end has no partition to date its event streams from, and that is the
   * `unknown` arm rather than a substituted `archivedAt`: archiving is a
   * display act and says nothing about when the events were written.
   */
  readonly endedAt: Readonly<{ state: "present"; value: string } | { state: "absent"; reason: string }>;
  /** Every evidence pointer the archived record names, by kind. */
  readonly pointerCounts: Readonly<{
    artifacts: number;
    checkpoints: number;
    writeIntents: number;
    ledgerLines: number;
  }>;
  readonly retentionDays?: number;
}

/**
 * The whole retention block for one archived run, computed.
 */
export function archiveRetention(input: ArchiveRetentionInput): ArchiveRetentionWire {
  const retentionDays = z.number().int().positive().parse(input.retentionDays ?? EVENT_STREAM_RETENTION_DAYS);
  const { pointerCounts } = input;
  const purgeable = pointerCounts.artifacts + pointerCounts.checkpoints;
  const total = purgeable + pointerCounts.writeIntents + pointerCounts.ledgerLines;

  const eventStreams: RetentionOutlook = RetentionOutlookSchema.parse(input.endedAt.state === "absent"
    ? {
      state: "unknown",
      reason: `this run's row carries no end instant (${input.endedAt.reason}), so the local day its `
        + "last events were partitioned into cannot be named",
    }
    : {
      state: "scheduled",
      purgeAt: eventStreamPurgeInstant(localDatePart(new Date(input.endedAt.value)), retentionDays),
      basis: `notes/ and spans/ prune at ${String(retentionDays)} days by file date (D86, ref dashboard-surfaces §2.1). This is `
        + "the earliest instant the partition holding this run's last events becomes eligible; the sweep runs "
        + "at dashboard boot, so the file survives until the first boot on or after it",
    });

  const evidence: RetentionOutlook = purgeable === 0
    ? {
      state: "permanent",
      basis: "this run archived no capture bytes and no checkpoint rows, so it names nothing a purge could take",
    }
    : {
      state: "on-request",
      basis: "captured bytes and checkpoint rows are retained until purge (ref dashboard-surfaces §10.4) — an operator act "
        + "(`cli purge-run`), not a schedule, so there is no instant to name",
    };

  return ArchiveRetentionWireSchema.parse({
    computedAt: input.now,
    row: {
      state: "permanent",
      basis: "authority schema v13 aborts UPDATE and DELETE on archived_runs in SQL, not by convention "
        + "(D179) — an archived row is the audit copy and nothing purges it",
    },
    eventStreams,
    evidence,
    ledger: {
      state: "permanent",
      basis: "the write ledger is never archived and never pruned (ref dashboard-surfaces §2.1 D21) — what was filed in a "
        + "real HR system outlives every display lifecycle",
    },
    pointers: {
      total,
      /*
       * Derived from the two guarantees above, and SAID to be derived: no
       * scheduled sweep purges an archived run's evidence, and there is no
       * read-back on this path to observe one that an operator removed by
       * hand. Claiming an observed count here would be the accessibility-tree
       * mistake of D187 in a different costume — a number that agrees with
       * itself and with nothing on disk.
       */
      retained: total,
      basis: "derived from the policy, not observed: no sweep purges an archived run's evidence, and the "
        + "archived detail reads nothing outside the archive tables, so no byte is read back to confirm it",
    },
  });
}
