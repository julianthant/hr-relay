import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { browserStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { defineTaskContract } from "../../src/models/task/task-contract.js";
import type { UcpathPersonOrgDriver } from "../../src/models/ui/ucpath-person-org.js";
import { ScenarioIdSchema,taskId } from "../../src/rules/identity/ids.js";
import {
createDeterministicSessionProvider,
defineUnwiredSessionProvider,
} from "../../src/workflow-kit/session.js";
import {
declareDriver,
declareDriverFor,
defineBrowserStore,
defineServiceStore,
defineTaskStoreRegistry,
} from "../../src/workflow-kit/task-registry.js";
import { defineTask } from "../../src/workflow-kit/task.js";

const SCENARIO = ScenarioIdSchema.parse("ucpath/store-fixture-happy");
const INPUT = z.strictObject({ value: z.string().min(1) });
const OUTPUT = z.strictObject({ value: z.string().min(1) });
const FIXTURE_DRIVER = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");

describe("task, store, session, and provider registration seams", () => {
  it("declares all nine browser stores with wired worker authentication and OnBase-only exclusivity", async () => {
    const expected = [
      "crm",
      "i9",
      "kuali",
      "new-kronos",
      "old-kronos",
      "onbase",
      "servicenow",
      "sharepoint",
      "ucpath",
    ];
    assert.deepEqual(browserStoreRegistry.stores.map(({ namespace }) => namespace).sort(), expected);
    const authenticated: string[] = [];
    const handle = {
      authenticate(system: string) {
        authenticated.push(system);
        return Promise.resolve("logged-in" as const);
      },
    };
    for (const store of browserStoreRegistry.stores) {
      assert.equal(store.kind, "browser");
      assert.equal(store.driver.system, store.namespace);
      assert.equal(store.session.system, store.namespace);
      assert.equal(store.session.exclusive === true, store.namespace === "onbase");
      assert.equal(await store.session.login(handle, {}), "logged-in");
    }
    assert.deepEqual(authenticated.sort(), expected);
    assert.throws(() => defineUnwiredSessionProvider("onbase"), /must declare exclusive:true/);
    assert.throws(
      () => defineUnwiredSessionProvider("ucpath", { exclusive: true }),
      /cannot declare exclusive:true/,
    );
  })

  it("binds tasks to exact effects/sessions and resolves corpus references in the store registry", () => {
    const contract = defineTaskContract({
      id: taskId("ucpath/search-store-fixture"),
      title: "Search store fixture",
      effect: "read",
      input: INPUT,
      output: OUTPUT,
      errorCodes: ["fixture-missing"] as const,
      subject: { kind: "none", reason: "registry resolution fixture" },
      scenarios: [SCENARIO],
      freshness: { defaultMaxAgeMs: 0 },
      provenance: { default: "live" },
      example: { value: "fixture" },
    });
    const task = defineTask(FIXTURE_DRIVER, contract, {
      sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
      async run({ input }) {
        return input;
      },
    });
    const session = createDeterministicSessionProvider("ucpath", ["logged-in"]).provider;
    const store = defineBrowserStore(
      "ucpath",
      FIXTURE_DRIVER,
      session,
      { searchStoreFixture: task },
    );
    assert.equal(task.driver, FIXTURE_DRIVER);
    assert.equal(store.tasks.searchStoreFixture.driver, store.driver);
    const corpus = {
      scenarioIds: [SCENARIO],
      tasks: [{ id: task.contract.id, effect: task.contract.effect }],
    };
    assert.doesNotThrow(() => defineTaskStoreRegistry([store], corpus));
    assert.throws(
      () => defineTaskStoreRegistry([store], { ...corpus, scenarioIds: [] }),
      /unresolved scenario/,
    );
    assert.throws(
      () => defineTaskStoreRegistry([store], { scenarioIds: [SCENARIO], tasks: [] }),
      /absent from the contract corpus/,
    );
    assert.throws(() => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, task.contract, {
      sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
      run: async ({ input }: { input: z.output<typeof INPUT> }) => input,
    }]), /requires read session access/);
    assert.throws(() => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, { ...task.contract }, task.impl]),
      /exact contract object returned by defineTaskContract/);
    assert.throws(() => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, task.contract, { run: task.impl.run }]),
      /requires sessions/);
    assert.throws(
      () => Reflect.apply(defineTask, undefined, [declareDriver("crm", "unwired"), task.contract, task.impl]),
      /cannot bind crm driver/,
    );
    const replacementDriver = declareDriverFor<UcpathPersonOrgDriver>()("ucpath", "semantic-ready");
    assert.throws(
      () => defineBrowserStore("ucpath", replacementDriver, session, { searchStoreFixture: task }),
      /must use the browser store's exact driver declaration/,
    );
    assert.throws(
      () => defineBrowserStore("crm", declareDriver("crm", "unwired"), session, {}),
      /cannot use ucpath session provider/,
    );
  })

  it("keeps service tasks sessionless and provider declarations capability-narrowed", () => {
    const scenario = ScenarioIdSchema.parse("ocr/provider-fixture-happy");
    const contract = defineTaskContract({
      id: taskId("ocr/read-provider-fixture"),
      title: "Read provider fixture",
      effect: "read",
      input: z.strictObject({}),
      output: OUTPUT,
      errorCodes: ["provider-unavailable"] as const,
      providers: ["ocr.extract"] as const,
      subject: { kind: "none", reason: "service provider fixture" },
      scenarios: [scenario],
      freshness: { defaultMaxAgeMs: 0 },
      provenance: { default: "derived" },
      example: { value: "fixture" },
    });
    const task = defineTask(contract, {
      sessions: [],
      async run() {
        return { value: "fixture" };
      },
    });
    const store = defineServiceStore("ocr", { readProviderFixture: task });
    assert.throws(
      () => Reflect.apply(defineTask, undefined, [FIXTURE_DRIVER, contract, task.impl]),
      /headless task cannot bind a browser driver/,
    );
    assert.doesNotThrow(() => defineTaskStoreRegistry([store], {
      scenarioIds: [scenario],
      tasks: [{ id: contract.id, effect: "read" }],
    }));
  })
});
