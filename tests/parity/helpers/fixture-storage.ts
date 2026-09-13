import {
FrontendBootstrapWireSchema,
type FrontendBootstrapWire,
} from "../../../src/domain/dashboard/bootstrap.js";
import { StorageDoctorWireSchema } from "../../../src/domain/dashboard/storage.js";
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { at,uuidOf } from "./fixture-identity.js";


/**
 * D281 item 7's isolated degraded profile. It reuses the Storage-health fixture
 * U3 introduced and changes only the authority fact, so the ordinary corpus
 * remains a healthy dashboard rather than using a fault to expose the band.
 */
export const FIXTURE_STORAGE_DEGRADED_BOOTSTRAP: FrontendBootstrapWire =
  FrontendBootstrapWireSchema.parse({
    ...FIXTURE_BOOTSTRAP,
    storage: {
      authority: "unavailable",
      backup: "current",
      checkedAt: at(0),
    },
  });


/** The strict loaded-doctor fixture: every degraded problem arm in one operator view. */
export const FIXTURE_STORAGE_DOCTOR = StorageDoctorWireSchema.parse({
  authorityUpgrades: { state: "absent", reason: "journal-empty" },
  protectedSettings: { state: "unavailable", cause: { code: "authority-unavailable", summary: "protected settings fixture is unavailable" } },
  mode: "read-only",
  checkedAt: at(1),
  authority: {
    state: "healthy",
    schemaVersion: 27,
    authorityGeneration: 41,
    pageCount: 12,
  },
  counts: {
    state: "available",
    values: {
      pendingCommands: 0,
      unresolvedWriteIntents: 0,
      leases: 0,
      providerReservations: 0,
      artifactOutbox: 0,
    },
  },
  spanAuthority: {
    state: "degraded",
    streamRunCount: 11,
    liveRunCount: 7,
    archived: [{ runId: uuidOf(401), archivedAt: "2026-08-03T08:00:00.000-07:00" }],
    deleted: [],
    problems: [
      { state: "missing", runId: uuidOf(402) },
      { state: "missing-span", runId: uuidOf(403) },
      {
        state: "malformed-authority",
        source: "archived",
        recordKey: "record-digest-8dc3",
        summary: "archived authority record failed strict parsing",
      },
      {
        state: "malformed",
        runId: uuidOf(404),
        table: "span_stream",
        summary: "queued root ordering is contradictory",
      },
    ],
  },
  backup: {
    state: "missing",
    cause: { code: "backup-missing", summary: "no verified backup is present" },
  },
  restoreCandidates: [],
  service: { state: "never-run", reason: "backup service has not run" },
});
