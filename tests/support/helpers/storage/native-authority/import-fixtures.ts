import { buildIntakeManifest } from "../../../../../src/models/intake/manifest.js";
import { IntakeSessionSchema } from "../../../../../src/models/intake/session.js";
import { NOW,HASH as hash,id } from "../../database-foundation/fixtures.js";
export function session(n = 1) {
  return IntakeSessionSchema.parse({ intakeSessionId: id(n), actorId: "local-operator", workflow: "person-lookup",
    artifact: { id: id(90), sha256: hash, bytes: 9, mediaType: "text/csv" },
    sourceName: "synthetic.csv", sheet: "default", headerRowIndex: null, bindings: [], constants: [], corrections: [], exclusions: [],
    state: "mapping", validation: { state: "none" }, reservedManifestId: id(n + 10), version: 1, createdAt: NOW, updatedAt: NOW });
}
export function manifest(n = 1) {
  return buildIntakeManifest({ manifestId: id(n + 10), workflow: "person-lookup",
    source: { artifactId: id(90), sha256: hash, originalName: "synthetic.csv" }, mappingFingerprint: hash, mappingSnapshotHash: hash,
    intakeProjectionFingerprint: hash, workflowContractFingerprint: hash, canonicalInputSchemaHash: hash, createdAt: NOW,
    sourceRows: 1, valid: [{ sourceRow: 1, itemId: id(80), inputHash: hash, parsedInput: { value: "retained" } }],
    currentRejects: new Map(), rejectionHistory: [], corrections: [], exclusions: [] });
}
