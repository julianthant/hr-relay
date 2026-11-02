import { randomUUID } from "node:crypto";
import type { Config } from "../../models/config/schema.js";
import { ProtectedStoreRecordSchema } from "../../models/config/protected-settings.js";
import { FingerprintSchema } from "../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import type { CommandBrowserCommands } from "../systems/browser-shared/command-session.js";
import type { ProtectedSecretSource } from "../../models/config/secrets.js";
import type { DuoSigningSource } from "../storage/configuration/duo-signing.js";
import { downloadSharePointWorkbook, parseSharePointWorkbookLink } from "../systems/sharepoint/driver/interpreter.js";
import { sharePointBrowserTransport } from "../processing/providers/sharepoint-browser-transport.js";
import { WorkbookLibraryError, type WorkbookSyncDownload } from "./workbook-library-service.js";

export function createSharePointWorkbookSync(deps: Readonly<{
  commands: CommandBrowserCommands;
  captureConfiguration(): Readonly<{ config: Config; assertCurrent(): void }>;
  protectedSecrets: ProtectedSecretSource;
  createDuoSource(): DuoSigningSource;
}>): WorkbookSyncDownload {
  return Object.freeze({
    async withDownload(command, use) {
      command.signal.throwIfAborted();
      const captured = deps.captureConfiguration();
      captured.assertCurrent();
      const target = parseSharePointWorkbookLink(command.link.url, captured.config.urls.sharepoint.prod.entry);
      const revision = ProtectedStoreRecordSchema.parse(deps.protectedSecrets.read()).revision;
      const readCapturedSecrets = () => {
        command.signal.throwIfAborted();
        captured.assertCurrent();
        const record = ProtectedStoreRecordSchema.parse(deps.protectedSecrets.read());
        if (record.revision !== revision)
          throw new WorkbookLibraryError("WORKBOOK_SYNC_CONTEXT_CHANGED");
        captured.assertCurrent();
        return record;
      };
      const assertCurrent = () => { readCapturedSecrets(); };
      assertCurrent();
      const duo = captured.config.features.duoWebAuthn ? deps.createDuoSource() : undefined;
      const requestDigest = FingerprintSchema.parse(sha256Hex(canonicalJsonStringify({
        libraryId: command.libraryId, operationId: command.operationId,
        expectedVersion: command.expectedVersion, link: command.link,
      })));
      return deps.commands.withCommand({
        commandId: randomUUID(), requestDigest, signal: command.signal, config: captured.config,
        protectedSecrets: { read: readCapturedSecrets },
        ...(duo === undefined ? {} : { duo }), assertCurrent,
      }, async scope => {
        const downloaded = await scope.withBrowser(browser => downloadSharePointWorkbook({
          ...browser, config: captured.config, instance: "prod", label: "manual SharePoint Sync",
        }, target, sharePointBrowserTransport));
        scope.assertCurrent();
        return use(downloaded, scope);
      });
    },
  } satisfies WorkbookSyncDownload);
}
