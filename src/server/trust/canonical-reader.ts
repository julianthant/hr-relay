import { RunRecordService } from "../../core/run-record-service.js";
import { systemClock, type Clock } from "../../domain/clock.js";
import type { AuthorityDatabase } from "../../infra/sqlite/authority-database.js";
import type { TrustRunReader } from "./run-reader.js";

/** CLI compositions receive only canonical reads, without mutation capabilities. */
export function createTrustRunReader(database: AuthorityDatabase, clock: Clock = systemClock): TrustRunReader & Pick<RunRecordService, "withRunTreeSnapshot"> {
  const forbidden = (): never => { throw new Error("TRUST_READER_MUTATION_FORBIDDEN"); };
  const service = new RunRecordService({ database, clock, ids: { uuid: forbidden }, publishQueued: forbidden });
  return Object.freeze({ read: service.read.bind(service), list: service.list.bind(service), withRunTreeSnapshot: service.withRunTreeSnapshot.bind(service) });
}
