import assert from "node:assert/strict";
import { afterEach,it,vi } from "vitest";
import * as admission from "../../../../src/backend/runs/lifecycle/delegation-admission.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

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
