/** Retention outlook per archived run: computed instants per record, a pure function of the record's fields, the policy constants, and `now`. */
import { z } from "zod";
import { localDatePart } from "../../rules/time/clock.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";

/** The sweep imports this constant, so the date this module computes and the date it acts on are one number. */
export const EVENT_STREAM_RETENTION_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** What will happen to one class of a run's data: four arms, each carrying its derivation. */
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

/** The retention block one archived run carries; every basis states a derivation, never an observation. */
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

/** The earliest instant `pruneEventStreams` can delete a partition: a file survives its retention day and goes on the first sweep of the day after. */
export function eventStreamPurgeInstant(localDate: string, retentionDays: number): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (parsed === null) throw new Error(`${localDate} is not a local partition date`);
  const day = new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3]));
  if (Number.isNaN(day.getTime())) throw new Error(`${localDate} is not a real calendar date`);
  // +1 day past the retention window: the file is eligible once the cutoff
  // date has moved strictly PAST its own date, never on the boundary day.
  return new Date(day.getTime() + (retentionDays + 1) * MILLISECONDS_PER_DAY).toISOString();
}

/* Not exported: every value here is already schema-bound by the archived record it is read off. */
interface ArchiveRetentionInput {
  /** When this block was computed — the surface renders relative to it. */
  readonly now: string;
    /* The run's own end instant, or the reason the row carries none; no end is the `unknown` arm, not a substituted `archivedAt`. */
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

/** The whole retention block for one archived run, computed. */
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
      basis: `notes/ and spans/ prune at ${String(retentionDays)} days by file date. This is `
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
      basis: "captured bytes and checkpoint rows are retained until purge — an operator act "
        + "(`cli purge-run`), not a schedule, so there is no instant to name",
    };

  return ArchiveRetentionWireSchema.parse({
    computedAt: input.now,
    row: {
      state: "permanent",
      basis: "authority schema v13 aborts UPDATE and DELETE on archived_runs in SQL, not by convention "
        + "— an archived row is the audit copy and nothing purges it",
    },
    eventStreams,
    evidence,
    ledger: {
      state: "permanent",
      basis: "the write ledger is never archived and never pruned — what was filed in a "
        + "real HR system outlives every display lifecycle",
    },
    pointers: {
      total,
            /* Derived from the two guarantees above, and said to be derived: no sweep purges an archived run's evidence. */
      retained: total,
      basis: "derived from the policy, not observed: no sweep purges an archived run's evidence, and the "
        + "archived detail reads nothing outside the archive tables, so no byte is read back to confirm it",
    },
  });
}
