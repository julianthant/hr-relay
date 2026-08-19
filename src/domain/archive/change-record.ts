/**
 * Charter §25's change record for a version bump — its own leaf module.
 *
 * It lives here rather than in `./model.ts` because BOTH the archive model and
 * `src/domain/commands.ts` need it, and the model already imports the command
 * vocabulary (`SemverSchema`, `VersionScopeSchema`). A shared leaf that value-
 * imports nothing but zod is the only shape that does not put a cycle between
 * them.
 */
import { z } from "zod";

/**
 * Charter §25's change record, as a value (doc 03 §10.2: "the scope of a bump
 * is declared by whoever makes the change … and recorded in that update's
 * change record — same store as fix records: what, why, version, commit").
 *
 * Every sweep on the Archive could say WHO applied it and WHEN, and nothing
 * about WHY. Six months later that is the only question anyone asks of a bump,
 * and it is the one an archive is FOR — so it is authored at plan time,
 * carried into the application verbatim, and covered by the plan fingerprint
 * the operator's apply cites back.
 *
 * `commit` is an explicit absence union rather than a required string. A
 * workflow bump usually has a commit and an application bump often does not
 * (the operator shipped a build, not a change), and demanding a hash would
 * mean a fabricated one on the record that exists to be trustworthy.
 */
export const VersionBumpChangeRecordSchema = z.strictObject({
  /** MAJOR is a shape change; MINOR is behaviour inside the same shape. */
  kind: z.enum(["major", "minor"]),
  /** What moved, in one line. */
  what: z.string().min(1).max(200),
  /** Why it moved — the half nobody can reconstruct from a diff. */
  why: z.string().min(1).max(1000),
  commit: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(7).max(120) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1).max(200) }),
  ]),
});
export type VersionBumpChangeRecord = z.infer<typeof VersionBumpChangeRecordSchema>;
