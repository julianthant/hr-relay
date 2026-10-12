import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timelineNoteLocation, timelineSpanLocation, type TimelineLine } from "../../../../src/backend/storage/events/timeline-reader.js";
import { TimelineEventRecordSchema, timelineAppendContent, type TimelineEventRecord, type TimelineRepository } from "../../../../src/models/events/timeline.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";





export function createJsonlWriterTestWorld() {
  const roots: string[] = [];

  const repositories = new Map<string, TimelineRepository>();

  function repositoryOf(root: string): TimelineRepository {
    let repository = repositories.get(root);
    if (repository === undefined) {
      const records: TimelineEventRecord[] = [];
      repository = { withReadSnapshot: read => read(), get: id => records.find(record => record.eventId === id),
        page: () => records, highWaterMark: () => records.length, pruneBefore: () => 0,
        append(input) {
          const record = TimelineEventRecordSchema.parse({ ...(input as object), cursor: records.length + 1 });
          const previous = records.find(row => row.eventId === record.eventId);
          if (previous !== undefined) {
            if (timelineAppendContent(previous) !== timelineAppendContent(record)) throw new Error("timeline-event-identity-conflict");
            return { state: "existing", record: previous };
          }
          canonicalJsonStringify(record); records.push(record); return { state: "inserted", record };
        } };
      repositories.set(root, repository);
    }
    return repository;
  }

  function nativeLines(root: string, kind: "spans" | "notes"): readonly TimelineLine[] {
    return repositoryOf(root).page({}).flatMap(record => {
      if (kind === "spans" && record.payload.kind === "span") return [timelineSpanLocation(record)];
      if (kind === "notes" && record.payload.kind === "note") return [timelineNoteLocation(record)];
      return [];
    });
  }

  function stateRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "hrauto-events-"));
    roots.push(root);
    return root;
  }

  const RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";

  const TRACE = "pl-104233-3b8f";

  const AT = new Date("2026-08-03T10:42:33.000-07:00");
  return { roots, repositories, repositoryOf, nativeLines, stateRoot, RUN_ID, TRACE, AT };
}
