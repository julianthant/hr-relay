import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import type { ActivityReportWire } from "../../../models/dashboard/activity.js";
import { ActivityReportSelectionSchema, ActivitySnapshotIdentitySchema, type ActivityReportSelection } from "../../../models/dashboard/activity-selection.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import { finishActivityRead } from "./activity-summaries.js";

export const ACTIVITY_SNAPSHOT_LIFETIME_MS = 15 * 60_000;

export const ActivityRangeSchema = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).refine(range => range.from <= range.to, { message: "activity range ends before it starts" });
export class ActivitySnapshotError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, `ACTIVITY_SNAPSHOT_${string}`>) {
    super(ERROR_CATALOG[code].text);
    this.name = "ActivitySnapshotError";
  }
}

/** `key` is the runtime's signing key: a lane that issues or validates a token for this runtime is given the same key. */
export function createActivitySnapshotSigner<Identity extends { expiresAt: string }>(schema: z.ZodType<Identity>, prefix: "as1" | "ap1",
  clock: Pick<Clock, "nowMs">, key: Uint8Array = randomBytes(32)) {
  const domain = prefix === "as1" ? "activity-selection:v1" : "activity-population:v1";
  const signature = (body: string) => createHmac("sha256", key).update(`${domain}:${body}`).digest();
  const encode = (identity: Identity) => {
    const body = Buffer.from(canonicalJsonStringify(identity)).toString("base64url");
    return `${prefix}.${body}.${signature(body).toString("base64url")}`;
  };
  const decode = (value: unknown): Identity => {
    const token = z.string().max(4096).safeParse(value);
    if (!token.success || !new RegExp(`^${prefix}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`, "u").test(token.data)) throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
    const [, body, mac] = token.data.split(".");
    const observed = Buffer.from(mac, "base64url"), expected = signature(body);
    if (observed.length !== expected.length || !timingSafeEqual(observed, expected)) throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
    const identity = schema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!identity.success || encode(identity.data) !== token.data || Date.parse(identity.data.expiresAt) <= clock.nowMs()) throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
    return identity.data;
  };
  return { encode, decode };
}

/** A process-bound, expiring review token. No cached/latest report substitutes for the selected authority. */
export function createActivitySelectionService<ReadContext = never>(input: {
  database: AuthorityDatabase; clock: Pick<Clock, "now" | "nowMs">; signingKey?: Uint8Array;
  /** A lane names the admitted profile store itself; its own connection does not carry the runtime's admission. */
  sourceIdentity?: string;
  read(from:string,to:string,generatedAt:string,context?:ReadContext): ActivityReportWire;
  chunks?(from:string,to:string,generatedAt:string,context?:ReadContext): Generator<void, ActivityReportWire, void>;
}) {
  const {database,clock}=input;
  const {encode,decode}=createActivitySnapshotSigner(ActivitySnapshotIdentitySchema,"as1",clock,input.signingKey);
  function* select(from:string, to:string, selected:z.infer<typeof ActivitySnapshotIdentitySchema> | undefined, context:ReadContext | undefined, chunked:boolean): Generator<void, ActivityReportSelection, void> {
    ActivityRangeSchema.parse({from,to});
    const authorityGeneration=database.getMeta().authorityGeneration,sourceIdentity=input.sourceIdentity??database.getSourceDatabaseIdentity();
    if(selected!==undefined&&(selected.from!==from||selected.to!==to||selected.sourceIdentity!==sourceIdentity||selected.authorityGeneration!==authorityGeneration))throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH");
    const generatedAt=selected?.generatedAt??clock.now().toISOString();
    const report = chunked && input.chunks !== undefined ? yield* input.chunks(from,to,generatedAt,context) : input.read(from,to,generatedAt,context);
    if (chunked) yield;
    const identity=ActivitySnapshotIdentitySchema.parse({from,to,generatedAt,sourceIdentity,authorityGeneration,
      expiresAt:selected?.expiresAt??new Date(clock.nowMs()+ACTIVITY_SNAPSHOT_LIFETIME_MS).toISOString(),reportDigest:sha256Hex(canonicalJsonStringify(report))});
    if(selected!==undefined&&identity.reportDigest!==selected.reportDigest)throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_CONTENT_MISMATCH");
    return ActivityReportSelectionSchema.parse({...report,snapshot:{...identity,token:encode(identity)}});
  }
  return Object.freeze({
    read:(from:string,to:string,context?:ReadContext)=>database.withAuthorityReadSnapshot(()=>finishActivityRead(select(from,to,undefined,context,false))),
    readSelected:(from:string,to:string,token:unknown,context?:ReadContext)=>database.withAuthorityReadSnapshot(()=>finishActivityRead(select(from,to,decode(token),context,false))),
    readChunks:(from:string,to:string,context?:ReadContext)=>select(from,to,undefined,context,true),
    readSelectedChunks:(from:string,to:string,token:unknown,context?:ReadContext)=>select(from,to,decode(token),context,true),
  });
}
/** What the Activity routes serve: answered now on the request thread, or later from a read lane. */
export interface ActivitySelectionService {
  /** A lane answers with the served body, built and validated there. */
  read(from: string, to: string): ActivityReportSelection | Promise<string>;
  readSelected(from: string, to: string, token: unknown): ActivityReportSelection | Promise<ActivityReportSelection>;
}
