import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { deriveSettingsCommandFingerprint, markSettingsCommand } from "../../../domain/commands.js";
import { ProviderKeyStoreUnknownError, type ProviderKeyJournal } from "../../../infra/config/provider-key-store.js";
import type { AuthorityDatabase } from "../../../infra/sqlite/authority-database.js";
import { providerCommandFromStore } from "./provider-key-projection.js";

export function createProviderKeyJournal(database: AuthorityDatabase): ProviderKeyJournal {
  const commands = () => database.authority.commands.listProviderSettingsCommands();
  const matchingAudit = (command: ReturnType<typeof commands>[number]) => {
    if (command.type !== "apply-provider-keys") throw new ProviderKeyStoreUnknownError("provider-journal-command-type");
    const audit = database.authority.commandAudits.findByCommand(command.commandId);
    if (audit === undefined || audit.request.type !== "apply-provider-keys"
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
      || audit.result.state !== "applied" || audit.result.providerRevision === undefined
      || audit.result.providerReceiptId === undefined
      || audit.result.affectedTargets.length !== 1
      || audit.result.affectedTargets[0]?.family !== "provider-keys"
      || audit.result.affectedTargets[0].revision !== audit.result.providerRevision
      || audit.versionChanges.length !== 1
      || audit.versionChanges[0]?.target.family !== "provider-keys"
      || audit.versionChanges[0].target.revision !== audit.result.providerRevision
      || Number(audit.versionChanges[0].before) !== Number(command.target.expectedRevision)
      || audit.versionChanges[0].after !== audit.result.providerRevision
      || audit.affectedDependencyIds.length !== 0) throw new ProviderKeyStoreUnknownError("provider-journal-audit-divergent");
    return { request: audit.request, result: audit.result };
  };
  const journal: ProviderKeyJournal = Object.freeze({
    committed(anchor: Parameters<ProviderKeyJournal["committed"]>[0]) {
      const command = database.authority.commands.get(anchor.commandId);
      if (command?.type !== "apply-provider-keys") return false;
      const audit = matchingAudit(command);
      const reconstructed = providerCommandFromStore({ ...anchor.request, operations: Object.fromEntries(
        Object.entries(anchor.operationMarks).map(([slot, mark]) => [slot, mark === "set" ? { set: "<set>" } : { clear: true }]),
      ) });
      const marked = markSettingsCommand(reconstructed);
      return command.payload.writeId === anchor.writeId
        && command.target.expectedRevision + 1 === anchor.revision
        && command.payload.providerSchemaHash === anchor.request.schemaHash
        && deriveSettingsCommandFingerprint(command) === anchor.markedFingerprint
        && canonicalJsonStringify(command) === canonicalJsonStringify(marked)
        && audit.result.providerRevision === anchor.revision
        && audit.result.providerReceiptId === anchor.receiptId;
    },
    latestCommitted(inFlight?: Readonly<{ commandId: string; writeId: string }>) {
      const history = commands();
      for (const command of history) {
        if (command.type !== "apply-provider-keys") throw new ProviderKeyStoreUnknownError("provider-journal-command-type");
        const audit = database.authority.commandAudits.findByCommand(command.commandId);
        if (audit === undefined) {
          if (inFlight?.commandId !== command.commandId || inFlight.writeId !== command.payload.writeId
            || command !== history.at(-1)) throw new ProviderKeyStoreUnknownError("provider-journal-audit-missing");
        } else matchingAudit(command);
      }
      const latest = [...history].reverse().find(command => database.authority.commandAudits.findByCommand(command.commandId) !== undefined);
      if (latest === undefined) return undefined;
      if (latest.type !== "apply-provider-keys") throw new ProviderKeyStoreUnknownError("provider-journal-command-type");
      const audit = matchingAudit(latest);
      return { commandId: latest.commandId, writeId: latest.payload.writeId,
        revision: audit.result.providerRevision! };
    },
    identityUsed(commandId: string, writeId: string) {
      return database.authority.commands.get(commandId) !== undefined
        || database.authority.commands.findProtectedSettingsCommandIdByWriteId({ writeId, excludingCommandId: commandId }) !== undefined
        || commands().some(command => command.type === "apply-provider-keys" && command.payload.writeId === writeId);
    },
    hasHistory() { return commands().length > 0; },
  });
  return journal;
}
