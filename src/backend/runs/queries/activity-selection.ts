import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { ActivityReportWireSchema, type ActivityReportWire } from "../../../models/dashboard/activity.js";
import { ActivityReportSelectionSchema, ActivitySnapshotIdentitySchema, ActivitySnapshotTokenSchema } from "../../../models/dashboard/activity-selection.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";

const RangeSchema = z.strictObject({ from: z.iso.date(), to: z.iso.date() }).refine(range => range.from <= range.to, { message: "activity range ends before it starts" });
/** A process-bound, expiring review token. No cached/latest report substitutes for the selected authority. */
export function createActivitySelectionService(input: {
  database: AuthorityDatabase; clock: Clock; read(from:string,to:string,generatedAt:string): ActivityReportWire;
}) {
  const key=randomBytes(32), {database,clock}=input;
  const signature=(body:string)=>createHmac("sha256",key).update(`activity-selection:v1:${body}`).digest();
  const encode=(identity:z.infer<typeof ActivitySnapshotIdentitySchema>)=>{
    const body=Buffer.from(canonicalJsonStringify(identity)).toString("base64url");
    return `as1.${body}.${signature(body).toString("base64url")}`;
  };
  const decode=(value:unknown)=>{
    try {
      const token=ActivitySnapshotTokenSchema.parse(value), [,body,mac]=token.split(".");
      if(body===undefined||mac===undefined)throw new Error();
      const observed=Buffer.from(mac,"base64url"),expected=signature(body);
      if(observed.length!==expected.length||!timingSafeEqual(observed,expected))throw new Error();
      const identity=ActivitySnapshotIdentitySchema.parse(JSON.parse(Buffer.from(body,"base64url").toString("utf8")));
      if(encode(identity)!==token||Date.parse(identity.expiresAt)<=clock.nowMs())throw new Error();
      return identity;
    } catch { throw new Error("activity-snapshot-invalid-or-expired"); }
  };
  const read=(from:string,to:string,selected?:z.infer<typeof ActivitySnapshotIdentitySchema>)=>database.withAuthorityReadSnapshot(()=>{
    RangeSchema.parse({from,to});
    const authorityGeneration=database.getMeta().authorityGeneration,sourceIdentity=database.getSourceDatabaseIdentity();
    if(selected!==undefined&&(selected.from!==from||selected.to!==to||selected.sourceIdentity!==sourceIdentity||selected.authorityGeneration!==authorityGeneration))throw new Error("activity-snapshot-stale-or-selection-mismatch");
    const generatedAt=selected?.generatedAt??clock.now().toISOString();
    const report=ActivityReportWireSchema.parse(input.read(from,to,generatedAt));
    const identity=ActivitySnapshotIdentitySchema.parse({from,to,generatedAt,sourceIdentity,authorityGeneration,
      expiresAt:selected?.expiresAt??new Date(clock.nowMs()+15*60_000).toISOString(),reportDigest:sha256Hex(canonicalJsonStringify(report))});
    if(selected!==undefined&&identity.reportDigest!==selected.reportDigest)throw new Error("activity-snapshot-content-mismatch");
    return ActivityReportSelectionSchema.parse({...report,snapshot:{...identity,token:encode(identity)}});
  });
  return Object.freeze({read:(from:string,to:string)=>read(from,to),readSelected:(from:string,to:string,token:unknown)=>read(from,to,decode(token))});
}
export type ActivitySelectionService=ReturnType<typeof createActivitySelectionService>;
