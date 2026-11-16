import assert from "node:assert/strict";
import { afterEach,it,vi } from "vitest";
import * as admission from "../../../../src/backend/runs/lifecycle/delegation-admission.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { observationLeafPaths, readObservationPath, resolveObservationOrigin } from "../../../../src/models/events/data-observation-origin.js";
import { SpanEventWireSchema } from "../../../../src/models/events/types.js";
import { ExtractPdfPages } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import type { TimelineEventRecord } from "../../../../src/models/events/timeline.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("authenticates every observation against its native event and producer before admitting children", async () => {
  const native = admission.admitDelegation;
  let verified = false;
  const probe = vi.spyOn(admission,"admitDelegation").mockImplementationOnce((dependencies,batch,plans,lifecycle) => {
    const database = dependencies.database;
    const generation = database.getMeta().authorityGeneration;
    const refuse = (alter: (repositories: AuthorityRepositories) => AuthorityRepositories, error: RegExp) => {
      const observed = new Proxy(database, { get(target,key) {
        if (key === "evidenceSchemaHash") return target.evidenceSchemaHash.bind(target);
        if (key === "withAuthorityTransaction") return <Result>(work: (repositories: AuthorityRepositories) => Result) =>
          target.withAuthorityTransaction(repositories => work(alter(repositories)));
        const value: unknown = Reflect.get(target,key,target);
        return value;
      } });
      assert.throws(() => native({ ...dependencies,database: observed },batch,plans,lifecycle),error);
      assert.equal(database.getMeta().authorityGeneration,generation);
    };
    refuse(repositories => ({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
      page: query => repositories.timelineEvents.page(query).filter(record => record.payload.kind !== "span" || record.payload.event.t !== "data.observed"),
    } }),/delegation-observation-event-mismatch/);
    for (const full of [false, true]) for (const invalid of ["empty-array", "missing-leaf", "extra-leaf"] as const) {
      let changed = 0;
      refuse(repositories => ({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
        page: query => repositories.timelineEvents.page(query).map(record => {
          if (record.payload.kind !== "span" || record.payload.event.t !== "data.observed" || record.payload.event.taskId !== ExtractPdfPages.id) return record;
          const event = record.payload.event;
          return { ...record, payload: { ...record.payload, event: { ...event, points: event.points.map(point => {
            if (point.field !== "pages") return point;
            assert.equal(point.values.length, 1);
            const value = point.values[0];
            assert.ok(value.state === "allowed" && value.classification === "sensitive-hr");
            const [first, ...rest] = ExtractPdfPages.output.shape.pages.parse(value.value);
            assert.ok(first);
            const { sourcePage: _omitted, ...pageWithoutLeaf } = first;
            const pages = JsonValueSchema.parse(invalid === "empty-array" ? [] : [
              invalid === "missing-leaf" ? pageWithoutLeaf : { ...first, extraLeaf: true }, ...rest,
            ]);
            changed++;
            return { ...point, values: [{ ...value, value: pages, rawValue: undefined }], origins: full
              ? observationLeafPaths(pages).map(path => ({ path: [...path], origin: resolveObservationOrigin(event, { field: point.field }, path) }))
              : undefined };
          }) } } };
        }),
      } }),/delegation-observation-event-mismatch/);
      assert.ok(changed > 0, `${invalid} must replace a ${full ? "full-origin" : "compact"} observation`);
    }
    for (const invalid of ["node", "task", "attempt", "span", "origin"] as const) {
      refuse(repositories => ({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
        page: query => repositories.timelineEvents.page(query).map(record => {
          if (record.payload.kind !== "span" || record.payload.event.t !== "data.observed") return record;
          const event = record.payload.event;
          const checkpoint = repositories.runCheckpoints.listByAttempt(batch.run.envelope.workflow, batch.run.envelope.itemId, event.nodeId, event.attempt)
            .find(checkpoint => checkpoint.runId === event.runId);
          assert.ok(checkpoint);
          return { ...record, payload: { ...record.payload, event: SpanEventWireSchema.parse({
            ...event,
            ...(invalid === "node" ? { nodeId: "foreign-node" } : invalid === "task" ? { taskId: "ocr/read-approved-records" }
              : invalid === "attempt" ? { attempt: event.attempt + 1 } : invalid === "span" ? { spanPath: `${event.spanPath}-foreign` }
                : { points: event.points.map(point => ({ ...point, origins: observationLeafPaths(readObservationPath(checkpoint.output.value, point.field.split(".")))
                  .map(path => ({ path: [...path], origin: { ...resolveObservationOrigin(event, point, path), spanPath: "foreign-span" } })) })) }),
          }) } };
        }),
      } }),/delegation-observation-event-mismatch/);
    }
    for (const invalid of ["origins","schema","implementation"] as const) {
      refuse(repositories => ({ ...repositories, runCheckpoints: { ...repositories.runCheckpoints,
        listByAttempt: (...args) => {
          const checkpoints = repositories.runCheckpoints.listByAttempt(...args);
          return checkpoints.map(checkpoint => invalid === "origins" ? { ...checkpoint,observationOrigins: [] }
            : invalid === "schema" ? { ...checkpoint,output: { ...checkpoint.output,schemaHash: FingerprintSchema.parse("0".repeat(64)) } }
              : { ...checkpoint,implFingerprint: FingerprintSchema.parse("0".repeat(64)) });
        },
      } }),/delegation-observation-checkpoint-mismatch/);
    }
    verified = true;
    return native(dependencies,batch,plans,lifecycle);
  });
  try {
    const f = await world.fixture();
    assert.equal(verified,true);
    assert.ok(f.database.authority.runs.listChildren(f.run.envelope.runId).length > 0);
  } finally { probe.mockRestore(); }
});

for (const opaque of [false, true]) it(`accepts retained full-origin events with ${opaque ? "redacted" : "retained"} values and ignores earlier attempts' unrelated fields`, async () => {
  const native = admission.admitDelegation;
  let expanded = 0;
  const probe = vi.spyOn(admission, "admitDelegation").mockImplementationOnce((dependencies, batch, plans, lifecycle) => {
    const database = dependencies.database;
    const observed = new Proxy(database, { get(target, key) {
      if (key === "evidenceSchemaHash") return target.evidenceSchemaHash.bind(target);
      if (key === "withAuthorityTransaction") return <Result>(work: (repositories: AuthorityRepositories) => Result) =>
        target.withAuthorityTransaction(repositories => work({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
          page: query => repositories.timelineEvents.page(query).flatMap<TimelineEventRecord>(record => {
            if (record.payload.kind !== "span" || record.payload.event.t !== "data.observed") return record;
            const event = record.payload.event;
            const failed = { ...record, payload: { ...record.payload, event: SpanEventWireSchema.parse({ ...event,
              spanPath: event.spanPath.replace(/\.\d+$/u, ".999"),
              points: [{ direction: "read", field: "failedRead", values: [{ key: "failedRead", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "Earlier failed read" }] }],
            }) } };
            return [failed, { ...record, payload: { ...record.payload, event: { ...event, points: event.points.map(point => {
              assert.equal(point.origins, undefined);
              expanded++;
              const paths = point.values.flatMap(value => {
                assert.ok(value.state === "allowed");
                if (event.taskId === ExtractPdfPages.id && point.field === "pages") assert.equal(value.classification, "sensitive-hr");
                return observationLeafPaths(JsonValueSchema.parse(value.value), value.key === point.field ? [] : value.key.slice(point.field.length + 1).split("."));
              });
              return { ...point, origins: paths.map(path => ({ path: [...path], origin: resolveObservationOrigin(event, point, path) })),
                values: opaque && point.field === "pages" ? point.values.map(value => ({ key: value.key, state: "redacted" as const,
                  classification: "sensitive-hr" as const, transform: "drop" as const })) : point.values };
            }) } } }];
          }),
        } }));
      const value: unknown = Reflect.get(target, key, target);
      return value;
    } });
    return native({ ...dependencies, database: observed }, batch, plans, lifecycle);
  });
  try {
    const f = await world.fixture();
    assert.ok(expanded > 0);
    assert.ok(f.database.authority.runs.listChildren(f.run.envelope.runId).length > 0);
  } finally { probe.mockRestore(); }
});
