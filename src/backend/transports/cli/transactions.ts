import { basename, dirname, extname, join } from "node:path";
import type { RuntimeAdmission } from "../../storage/admission/admission.js";
import { exportTransactions, parseTransactionExportArgs, TRANSACTION_EXPORT_HELP } from "../../storage/maintenance/transaction-export.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { createTransactionHistory } from "../../storage/sqlite/transaction-history.js";
import { PERSON_STORE_SIGN_IN_REQUIRED, readPersonStore, readStore, selectPersonStores } from "./person-stores.js";

export const TRANSACTION_COMMAND_HELP = `${TRANSACTION_EXPORT_HELP}On an installation, each ready person's report is written beside PATH as NAME.<profile-id>.EXT.\n`;

type ExportRequest = Extract<ReturnType<typeof parseTransactionExportArgs>, { kind: "export" }>["request"];

const exportFrom = (request: ExportRequest) => (database: AuthorityDatabase) => exportTransactions(createTransactionHistory(database.authority), request);

function personReportPath(output: string, profileId: string): string {
  const extension = extname(output);
  return join(dirname(output), `${basename(output, extension)}.${profileId}${extension}`);
}

/** An installation reports the signed-in person's store; signed-out stores stay closed. */
export function composeTransactionExportCommand(admission: RuntimeAdmission, args: readonly string[]): string {
  const command = parseTransactionExportArgs(args);
  if (command.kind === "help") return TRANSACTION_COMMAND_HELP;
  if (!admission.isInstallation()) return `${JSON.stringify(readStore(admission, "transaction-export", exportFrom(command.request)))}\n`;
  const { ready, signedIn, notChecked } = selectPersonStores(admission);
  if (signedIn === null) {
    process.exitCode = 1;
    return `storage transactions REFUSED — ${PERSON_STORE_SIGN_IN_REQUIRED}\n`;
  }
  const profiles: Array<{ profileId: string } & ReturnType<typeof exportTransactions>> = [];
  for (const profileId of [signedIn]) {
    profiles.push({ profileId, ...readPersonStore(admission, profileId, "transaction-export",
      exportFrom({ ...command.request, output: personReportPath(command.request.output, profileId) })) });
  }
  return `${JSON.stringify({ profiles, ...(ready.length > 1 ? { notChecked } : {}) })}\n`;
}
