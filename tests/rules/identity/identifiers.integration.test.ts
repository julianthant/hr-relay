import { createSeparationStartFixtures } from "../../support/helpers/backend/separation-start-fixtures.js";
import assert_m0 from "node:assert/strict";
import { rmSync as rmSync_m0 } from "node:fs";
import { afterEach as afterEach_m0, describe as describe_m0, it as it_m0 } from "vitest";

import { deriveItemId as deriveItemId_m0 } from "../../../src/rules/identity/identifiers.js";
import { manualClock as manualClock_m0 } from "../../../src/rules/time/clock.js";
import { NOW as NOW_m0 } from "../../support/fixtures/phase1c-contract-fixtures.js";



import { createBoundProfileFixture as createBoundProfileFixture_m0 } from "../../support/helpers/admission-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m0 } from "../../support/helpers/synthetic-storage-admission.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1, it as it_m1 } from "vitest";
import { deriveItemId as deriveItemId_m1, deriveTraceId as deriveTraceId_m1 } from "../../../src/rules/identity/identifiers.js";
import { manualClock as manualClock_m1 } from "../../../src/rules/time/clock.js";
import { NOW as NOW_m1 } from "../../support/fixtures/phase1c-contract-fixtures.js";

{

const CLOCK = manualClock_m0(new Date(NOW_m0));

const SUBMISSION = Object.freeze({
  documentNumber: "4510",
});

const roots: string[] = [];
const databases: AuthorityDatabase_m0[] = [];

const _afterEachFixture0 = () => {
  while (databases.length > 0) databases.pop()?.close();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync_m0(root, { recursive: true, force: true });
  }

};

function openDatabase(): AuthorityDatabase_m0 {
  const profile = createBoundProfileFixture_m0();
  const database = AuthorityDatabase_m0.open(
    { path: profile.path, busyTimeoutMs: 250, migrationOwner: "unit-test" },
    CLOCK,
  );
  const close = database.close.bind(database);
  database.close = () => { close(); profile.close(); };
  databases.push(database);
  return database;
}

const { plan } = createSeparationStartFixtures(openDatabase, CLOCK);

describe_m0("separations — start planning through the existing service", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("plans one item per document, and refuses a submission the ingress does not admit", () => {

    const planned = plan([SUBMISSION, { ...SUBMISSION, actionId: "6a7a33b2ac106d428b3217e0" }]);
    assert_m0.equal(planned.planned.length, 1);
    assert_m0.equal(planned.planned[0]?.matchKey, "separations:4510");
    assert_m0.equal(
      planned.planned[0]?.itemId,
      deriveItemId_m0("separations", "separations:4510"),
    );

    assert_m0.equal(planned.refused.length, 1);
    assert_m0.deepEqual(planned.refused[0]?.rawInput, {
      ...SUBMISSION,
      actionId: "6a7a33b2ac106d428b3217e0",
    });
  });
});
}

{

const CLOCK = manualClock_m1(new Date(NOW_m1));

describe_m1("derived identity", () => {

  it_m1("derives one logical item per match key, stably", () => {
    const first = deriveItemId_m1("person-lookup", "eid:10873698");
    assert_m1.equal(first, deriveItemId_m1("person-lookup", "eid:10873698"));
    assert_m1.notEqual(first, deriveItemId_m1("person-lookup", "eid:10101010"));
    assert_m1.notEqual(first, deriveItemId_m1("separation", "eid:10873698"));
  });

  it_m1("derives a trace id bound to the run it names", () => {
    const runId = "abcdef01-2345-4678-8abc-def012345678";
    const traceId = deriveTraceId_m1("pl", runId, CLOCK);
    assert_m1.match(traceId, /^pl-\d{6}-abcd$/);
  });
});
}
