import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ActivityReportWireSchema, type ActivityReportWire } from "../../../models/dashboard/activity.js";
import { ActivityReportSelectionSchema, ActivitySnapshotIdentitySchema } from "../../../models/dashboard/activity-selection.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

const RangeSchema = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).refine(range => range.from <= range.to, { message: "activity range ends before it starts" });
export class ActivitySnapshotError extends Error {
  constructor(readonly code: "activity-snapshot-invalid-or-expired" | "activity-snapshot-stale-or-selection-mismatch" | "activity-snapshot-content-mismatch") {
    super(code);
    this.name = "ActivitySnapshotError";
  }
}

export function createActivitySnapshotSigner<Identity extends { expiresAt: string }>(schema: z.ZodType<Identity>, prefix: "as1" | "ap1", clock: Clock) {
  const key = randomBytes(32);
  const domain = prefix === "as1" ? "activity-selection:v1" : "activity-population:v1";
  const signature = (body: string) => createHmac("sha256", key).update(`${domain}:${body}`).digest();
  const encode = (identity: Identity) => {
    const body = Buffer.from(canonicalJsonStringify(identity)).toString("base64url");
    return `${prefix}.${body}.${signature(body).toString("base64url")}`;
  };
  const decode = (value: unknown): Identity => {
    const token = z.string().max(4096).safeParse(value);
    if (!token.success || !new RegExp(`^${prefix}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`, "u").test(token.data)) throw new ActivitySnapshotError("activity-snapshot-invalid-or-expired");
    const [, body, mac] = token.data.split(".");
    const observed = Buffer.from(mac, "base64url"), expected = signature(body);
    if (observed.length !== expected.length || !timingSafeEqual(observed, expected)) throw new ActivitySnapshotError("activity-snapshot-invalid-or-expired");
    const identity = schema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!identity.success || encode(identity.data) !== token.data || Date.parse(identity.data.expiresAt) <= clock.nowMs()) throw new ActivitySnapshotError("activity-snapshot-invalid-or-expired");
    return identity.data;
  };
  return { encode, decode };
}

/** A process-bound, expiring review token. No cached/latest report substitutes for the selected authority. */
export function createActivitySelectionService(input: {
  database: AuthorityDatabase; clock: Clock; read(from:string,to:string,generatedAt:string): ActivityReportWire;
}) {
  const {database,clock}=input;
  const {encode,decode}=createActivitySnapshotSigner(ActivitySnapshotIdentitySchema,"as1",clock);
  const read=(from:string,to:string,selected?:z.infer<typeof ActivitySnapshotIdentitySchema>)=>database.withAuthorityReadSnapshot(()=>{
    RangeSchema.parse({from,to});
    const authorityGeneration=database.getMeta().authorityGeneration,sourceIdentity=database.getSourceDatabaseIdentity();
    if(selected!==undefined&&(selected.from!==from||selected.to!==to||selected.sourceIdentity!==sourceIdentity||selected.authorityGeneration!==authorityGeneration))throw new ActivitySnapshotError("activity-snapshot-stale-or-selection-mismatch");
    const generatedAt=selected?.generatedAt??clock.now().toISOString();
    const report=ActivityReportWireSchema.parse(input.read(from,to,generatedAt));
    const identity=ActivitySnapshotIdentitySchema.parse({from,to,generatedAt,sourceIdentity,authorityGeneration,
      expiresAt:selected?.expiresAt??new Date(clock.nowMs()+15*60_000).toISOString(),reportDigest:sha256Hex(canonicalJsonStringify(report))});
    if(selected!==undefined&&identity.reportDigest!==selected.reportDigest)throw new ActivitySnapshotError("activity-snapshot-content-mismatch");
    return ActivityReportSelectionSchema.parse({...report,snapshot:{...identity,token:encode(identity)}});
  });
  return Object.freeze({read:(from:string,to:string)=>read(from,to),readSelected:(from:string,to:string,token:unknown)=>read(from,to,decode(token))});
}
export type ActivitySelectionService=ReturnType<typeof createActivitySelectionService>;
