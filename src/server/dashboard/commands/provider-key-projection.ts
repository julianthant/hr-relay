import {
  ProviderKeysCommandRequestSchema, deriveSettingsCommandFingerprint,
  type CommandRequest,
} from "../../../domain/commands.js";
import type { ProviderKeyWriteRequest } from "../../../infra/config/provider-key-store.js";

export function providerStoreRequest(command: Extract<CommandRequest, { type: "apply-provider-keys" }>): ProviderKeyWriteRequest {
  const request = ProviderKeysCommandRequestSchema.parse(command);
  return {
    commandId: request.commandId, writeId: request.payload.writeId,
    expectedRevision: request.target.expectedRevision,
    expectedSourceVersionToken: request.target.sourceVersionToken,
    schemaHash: request.payload.providerSchemaHash,
    requestedAt: request.requestedAt, requestedBy: request.requestedBy,
    source: request.source, ...(request.reason === undefined ? {} : { reason: request.reason }),
    operations: request.payload.operations,
  };
}

export function providerCommandFromStore(request: ProviderKeyWriteRequest) {
  return ProviderKeysCommandRequestSchema.parse({
    commandId: request.commandId, requestedAt: request.requestedAt, requestedBy: request.requestedBy,
    source: request.source, ...(request.reason === undefined ? {} : { reason: request.reason }),
    family: "settings", type: "apply-provider-keys",
    target: { expectedRevision: request.expectedRevision, sourceVersionToken: request.expectedSourceVersionToken },
    payload: { providerSchemaHash: request.schemaHash, writeId: request.writeId,
      operations: request.operations },
  });
}

export function providerMarkedFingerprint(request: ProviderKeyWriteRequest): string {
  return deriveSettingsCommandFingerprint(providerCommandFromStore(request));
}
