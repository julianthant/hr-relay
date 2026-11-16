import { basename, dirname, extname, join } from "node:path";
import type { RuntimeAdmission } from "../../storage/admission/admission.js";
import { exportTransactions, parseTransactionExportArgs, TRANSACTION_EXPORT_HELP } from "../../storage/maintenance/transaction-export.js";
import { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { createTransactionHistory } from "../../storage/sqlite/transaction-history.js";

export const TRANSACTION_COMMAND_HELP = `${TRANSACTION_EXPORT_HELP}On an installation, each ready person's report is written beside PATH as NAME.<profile-id>.EXT.\n`;

type ExportRequest = Extract<ReturnType<typeof parseTransactionExportArgs>, { kind: "export" }>["request"];

function exportStore(owner: RuntimeAdmission, request: ExportRequest) {
  const database = AuthorityDatabase.open(owner, { path: join(owner.stateRoot, "state.db"),
    busyTimeoutMs: 5000, migrationOwner: "transaction-export", openMode: "storage-doctor-read-only-no-migrate" });
  try { return exportTransactions(createTransactionHistory(database.authority), request); }
  finally { database.close(); }
}

function personReportPath(output: string, profileId: string): string {
  const extension = extname(output);
  return join(dirname(output), `${basename(output, extension)}.${profileId}${extension}`);
}

/** Each person keeps their own store under the machine root, so an installation exports every ready person in turn, as storage doctor reads them. */
export function composeTransactionExportCommand(admission: RuntimeAdmission, args: readonly string[]): string {
  const command = parseTransactionExportArgs(args);
  if (command.kind === "help") return TRANSACTION_COMMAND_HELP;
  if (!admission.isInstallation()) return `${JSON.stringify(exportStore(admission, command.request))}\n`;
  const profiles: Array<{ profileId: string } & ReturnType<typeof exportTransactions>> = [];
  for (const { profileId } of admission.readProfileRegistry().profiles.filter(row => row.lifecycle === "ready")) {
    const owner = admission.admitProfile(profileId);
    try { profiles.push({ profileId, ...exportStore(owner, { ...command.request, output: personReportPath(command.request.output, profileId) }) }); }
    finally { owner.release(); }
  }
  return `${JSON.stringify({ profiles })}\n`;
}
