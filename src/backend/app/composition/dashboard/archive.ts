import {
  DESCRIPTORS,
} from "../../registries/workflow-registry.js";

import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/index.js";

import { type ArchiveQueryDeps } from "../../../runs/queries/archive.js";

export function createOperatorArchive(input: Omit<ArchiveQueryDeps, "authority" | "descriptors"> & { database: AuthorityDatabase; reader: Pick<RunRecordService, "read" | "list"> }): ArchiveQueryDeps {
  const { clock, appVersion, database, ledger } = input;
  return {
    reader: input.reader,
    clock,
    appVersion,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    descriptors: { list: () => DESCRIPTORS },
    // The archive's ledger read-through, over the SAME state root the
    // projector appends to — the pointers stay pointers and this is what
    // turns them back into what was filed.
    ledger,
  };
}
