import {
  DESCRIPTORS,
} from "../../../control/workflow-registry.js";

import { RunRecordService } from "../../../core/run-record-service.js";

import {
  AuthorityDatabase,
} from "../../../infra/sqlite/index.js";
import { createServerVerifiedArtifactReader } from "../../../infra/artifacts/server-verified-artifact-reader.js";

import { createReceiptService } from "../../trust/receipt-service.js";

export function createTrustReadDependencies(input: { database: AuthorityDatabase; artifactReader: ReturnType<typeof createServerVerifiedArtifactReader>; reader: Pick<RunRecordService, "read" | "list"> }) {
  const { database, artifactReader, reader } = input;
  return { trust: createReceiptService({ database, descriptors: DESCRIPTORS, runReader: reader }), captures: { runReader: reader, authority: database.authority.diagnosticBundles, artifactReader }, diagnosticBundles: { runReader: reader, authority: database.authority.diagnosticBundles, artifactReader } };
}

export { readGateParks } from "./notifications.js";
