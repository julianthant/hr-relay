import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempDisposable, readFile } from "node:fs/promises";
import { createServer as createSecureServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { createKualiRrssDocumentDriver } from "../../../../../src/backend/systems/kuali/driver/interpreter.js";
import { KUALI_RRSS_SPACE_ID } from "../../../../../src/backend/systems/kuali/driver/ui-registry.js";
import { kualiFinalizationVerdict } from "../../../../../src/backend/systems/kuali/finalization-verdict.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../../src/models/ui/kuali-rrss-document.js";
import { KualiFinalizationTargetSchema } from "../../../../../src/models/ui/kuali-separation-finalization.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { systemClock, type Clock } from "../../../../../src/rules/time/clock.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import { kualiFinalizationVariablesInput } from "../../../../support/helpers/kuali-finalization-input-fixtures.js";

const ACTION_LIST_URL = `https://ucsd.kualibuild.com/build/space/${KUALI_RRSS_SPACE_ID}/actions`;
const DOCUMENT_NUMBER = "123456";
const DOCUMENT_ID = "fixture-document-id";
const TARGET = KualiFinalizationTargetSchema.parse({
  actionId: "123456789abcdef012345678",
  documentNumber: DOCUMENT_NUMBER,
  emplId: "10000000",
  variables: {
    ...kualiFinalizationVariablesInput(),
    timekeeperName: "Fixture Timekeeper",
    timekeeperComments: "Fixture finalization comment",
  },
});
const DOCUMENT_URL = `${ACTION_LIST_URL}/${TARGET.actionId}`;
const GRAPHQL_URL = "https://ucsd.kualibuild.com/app/api/v0/graphql";
const SAVE_QUERY = `mutation submitDocumentV2($documentId: ID!, $data: JSON, $actionId: ID!, $status: String, $comment: String, $timeZone: String, $overriddenFields: [String!]) {
  submitDocumentV2(
    id: $documentId
    data: $data
    actionId: $actionId
    status: $status
    comment: $comment
    timeZone: $timeZone
    overriddenFields: $overriddenFields
  ) {
    id
    status
    label
    documentSetId
    validations {
      formKeys
      label
      message
      __typename
    }
    query {
      viewer {
        id
        actionCount
        __typename
      }
      myDrafts(args: {skip: 0, limit: 1}) {
        totalCount
        __typename
      }
      __typename
    }
    __typename
  }
}`;
const ACTION_LIST_QUERY = `query OldActions($args: ActionConnectionInput!) {
  actions: actionsConnection(args: $args) {
    totalCount
    edges {
      node {
        id
        type
        createdAt
        display
        details
        handlerUrl
        __typename
      }
      __typename
    }
    __typename
  }
}`;

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true, args: ["--host-resolver-rules=MAP * ~NOTFOUND"] });
});
afterAll(async () => { await browser?.close(); });
beforeEach(async () => {
  context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => route.abort());
  page = await context.newPage();
});
afterEach(async () => { await context?.close(); });

function documentForm(transactionNumber = "", payrollTitle = ""): string {
  return `
    <h1>${DOCUMENT_NUMBER}</h1>
    <label>EID*<input value="${TARGET.emplId}"></label>
    <label>Department*<select><option>- - -</option><option>${TARGET.variables.department}</option></select></label>
    <label>Payroll Title Code*<input></label>
    <label>Payroll Title*<input value="${payrollTitle}"></label>
    <label>Request Acknowledged - In Progress<input type="checkbox"></label>
    <label>Timekeeper Name:*<input></label>
    <label>Last Day Worked*<input></label>
    <label>Separation Date (Last day actively employed)*<input></label>
    <label>Termination Effective Date*<input></label>
    <label>Submitted Termination Template<input type="checkbox"></label>
    <label>Transaction Number:*<input value="${transactionNumber}"></label>
    <label>Submitted Final Pay Request<input type="radio" name="finalPay"></label>
    <label>Does not need Final Pay (student employee)<input type="radio" name="finalPay"></label>
    <label>Does not need Final Pay (transfer employee)<input type="radio" name="finalPay"></label>
    <label>Other<input type="radio" name="finalPay"></label>
    <label>Timekeeper/Approver Comments:<textarea></textarea></label>
    <button>Save</button>
    <script>
      for (const control of document.querySelectorAll("input,select,textarea")) {
        control.__reactPropsFixture = {};
        control.addEventListener("input", () => { control.__reactPropsFixture = {}; });
      }
    </script>`;
}

function saveVariables(): {
  actionId: string;
  status: string;
  data: Record<string, unknown>;
  documentId: string;
  timeZone: string;
  overriddenFields: string[];
} {
  return {
    actionId: TARGET.actionId,
    documentId: DOCUMENT_ID,
    status: "saved",
    timeZone: "America/Los_Angeles",
    overriddenFields: [],
    data: {
      JPYGckVxcf: { id: "dept", label: TARGET.variables.department },
      "2FlOeR5pd9": TARGET.variables.payrollTitleCode,
      sVmpq6tG9X: TARGET.variables.payrollTitle,
      xKRU6vmYSY: [{ id: "acknowledged" }],
      QGJ63YrCom: TARGET.variables.timekeeperName,
      ER1WhBzjcm: Date.UTC(2026, 5, 9),
      oEcp1xtQkj: Date.UTC(2026, 5, 10),
      DoWSfJhpRm: Date.UTC(2026, 5, 11),
      "6Ejy-1rfQJ": [{ id: "submitted" }],
      wPyuyY0wT0: TARGET.variables.transactionNumber,
      "8CXaCSIvx5": { id: "student" },
      J_upFRq074: TARGET.variables.timekeeperComments,
    },
  };
}

async function stageSave(variables: ReturnType<typeof saveVariables>, query = SAVE_QUERY, clock: Clock = systemClock) {
  const { driver, received: lookups } = await setupActionList({ clock });
  const payload = { operationName: "submitDocumentV2", query, variables };
  const forwarded: unknown[] = [];
  await context.route(DOCUMENT_URL, route => route.fulfill({
    contentType: "text/html",
    body: documentForm(),
  }));
  await context.route(GRAPHQL_URL, async route => {
    const received: unknown = route.request().postDataJSON();
    if (typeof received === "object" && received !== null
      && "operationName" in received && received.operationName === "OldActions") {
      await route.fallback();
      return;
    }
    forwarded.push(received);
    const observedEnvelope = isDeepStrictEqual(received, payload);
    await route.fulfill({ json: observedEnvelope
      ? { data: { submitDocumentV2: { status: "Ok", validations: null } } }
      : { errors: [{ message: "fixture received a different Save envelope" }] } });
  });
  await driver.stageSeparationFinalization(TARGET);
  await page.evaluate(({ graphqlUrl, payload }) => {
    const submit = async () => {
      try {
        await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch { /* The fixture observes forwarding at the server boundary. */ }
    };
    document.querySelector("button")?.addEventListener("click", () => { void submit(); });
  }, { graphqlUrl: GRAPHQL_URL, payload });
  const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)), () => 30_000);
  return { driver, forwarded, lookups, payload, commit: () => driver.commit(KUALI_RRSS_SAVE_BUTTON, capability) };
}

function actionListEdge(number: string, id: string) {
  return {
    node: {
      id,
      type: "Task",
      createdAt: "1784000000000",
      handlerUrl: `/action/${id}`,
      display: { id: "RRSS Separation Request Form", documentTitle: number, type: "Task Form" },
      details: { serialNumber: number, documentId: DOCUMENT_ID, stepLabel: "Fixture" },
    },
  };
}

async function setupActionList(options: {
  initial?: string;
  links?: string;
  rowsUnchanged?: boolean;
  failure?: boolean;
  edges?: ReturnType<typeof actionListEdge>[];
  clock?: Clock;
} = {}) {
  const initial = options.initial ?? "";
  const received: unknown[] = [];
  await context.route(ACTION_LIST_URL, route => route.fulfill({
    contentType: "text/html",
    body: `
      <input aria-label="Search" value="${initial}">
      <button>GO</button>
      <div id="rows">${options.links ?? ""}</div>
      <script>
        let previous = ${JSON.stringify(initial)};
        document.querySelector("button").onclick = async () => {
          const query = document.querySelector("input").value;
          if (query === previous) return;
          previous = query;
          const response = await fetch(${JSON.stringify(GRAPHQL_URL)}, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              operationName: "OldActions",
              variables: { args: { skip: 0, limit: 25, sort: ["-createdAt"], query } },
              query: ${JSON.stringify(ACTION_LIST_QUERY)},
            }),
          });
          if (!response.ok) {
            document.querySelector("#neighbor")?.remove();
            return;
          }
          const { data } = await response.json();
          if (${String(options.rowsUnchanged ?? false)}) return;
          document.querySelector("#rows").replaceChildren(...data.actions.edges.map(({ node }) => {
            const link = document.createElement("a");
            link.textContent = node.details.serialNumber;
            link.href = ${JSON.stringify(`${ACTION_LIST_URL}/`)} + node.id;
            return link;
          }));
        };
      </script>`,
  }));
  await context.route(GRAPHQL_URL, async route => {
    received.push(route.request().postDataJSON());
    const edges = options.edges ?? [actionListEdge(DOCUMENT_NUMBER, TARGET.actionId)];
    await route.fulfill({
      status: options.failure ? 500 : 200,
      json: options.failure ? { errors: [{ message: "fixture lookup failed" }] }
        : { data: { actions: { totalCount: edges.length, edges } } },
    });
  });
  return { driver: createKualiRrssDocumentDriver(() => undefined, page, options.clock ?? systemClock), received };
}

describe("Kuali finalization safety", () => {
  it("resolves a filtered result by its exact document number", async () => {
    const { driver } = await setupActionList({
      links: '<a href="/neighbor">654321</a>',
      edges: [actionListEdge(DOCUMENT_NUMBER, TARGET.actionId), actionListEdge("9123456", "abcdef0123456789abcdef01")],
    });
    const observation = await driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER });
    assert.deepEqual(observation.matchedLinks, [{ name: DOCUMENT_NUMBER, href: DOCUMENT_URL }]);
  });

  it("accepts the same rendered row when a fresh filter verifies its action ID", async () => {
    const { driver } = await setupActionList({
      links: `<a href="${DOCUMENT_URL}">${DOCUMENT_NUMBER}</a>`, rowsUnchanged: true,
    });
    const observation = await driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER });
    assert.deepEqual(observation.matchedLinks, [{ name: DOCUMENT_NUMBER, href: DOCUMENT_URL }]);
  }, 25_000);

  it("gets a fresh filter when Kuali would skip the already selected search term", async () => {
    const { driver, received } = await setupActionList({
      initial: DOCUMENT_NUMBER, links: `<a href="${DOCUMENT_URL}">${DOCUMENT_NUMBER}</a>`, rowsUnchanged: true,
    });
    const observation = await driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER });
    assert.deepEqual(observation.matchedLinks, [{ name: DOCUMENT_NUMBER, href: DOCUMENT_URL }]);
    assert.deepEqual(received, [DOCUMENT_NUMBER.slice(0, -1), DOCUMENT_NUMBER].map(query => ({
      operationName: "OldActions",
      variables: { args: { skip: 0, limit: 25, sort: ["-createdAt"], query } },
      query: ACTION_LIST_QUERY,
    })));
  }, 25_000);

  it("rejects stale exact links when a failed filter coincides with unrelated list churn", async () => {
    const { driver } = await setupActionList({
      links: `<a id="neighbor" href="/neighbor">654321</a><a href="${DOCUMENT_URL}">${DOCUMENT_NUMBER}</a>`,
      failure: true,
    });
    await assert.rejects(driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER }), /outcome is unknown/u);
  });

  it("reports an unknown lookup when the Action List submits unreadable GraphQL", async () => {
    await context.route(ACTION_LIST_URL, route => route.fulfill({
      contentType: "text/html",
      body: `
        <input aria-label="Search">
        <button>GO</button>
        <a href="${DOCUMENT_URL}">${DOCUMENT_NUMBER}</a>
        <script>
          document.querySelector("button").onclick = () => fetch(${JSON.stringify(GRAPHQL_URL)}, {
            method: "POST", headers: { "content-type": "application/json" }, body: "{",
          });
        </script>`,
    }));
    await context.route(GRAPHQL_URL, route => route.fulfill({ status: 400 }));
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);

    await assert.rejects(driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /outcome is unknown/u);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.message, "Kuali Action List GraphQL request body is unreadable");
      return true;
    });
  }, 25_000);

  it("allows a confirmed empty filter result even while an old exact row is still visible", async () => {
    const { driver } = await setupActionList({
      links: `<a href="${DOCUMENT_URL}">${DOCUMENT_NUMBER}</a>`, rowsUnchanged: true, edges: [],
    });
    const observation = await driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER });
    assert.deepEqual(observation.matchedLinks, []);
    assert.deepEqual(observation.listedDocumentNumbers, []);
  }, 25_000);

  it("reports an unknown lookup when GO leaves a stale list without a proved match", async () => {
    await context.route(ACTION_LIST_URL, route => route.fulfill({
      contentType: "text/html",
      body: `
        <input aria-label="Search">
        <button>GO</button>
        <a href="/previous">123455</a>`,
    }));
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);

    await assert.rejects(
      driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER }),
      /Kuali Action List lookup for document 123456.*outcome is unknown/u,
    );
  }, 25_000);

  it("reports an unknown lookup when failed GO leaves an old exact-number row", async () => {
    await context.route(ACTION_LIST_URL, route => route.fulfill({
      contentType: "text/html",
      body: `
        <input aria-label="Search">
        <button>GO</button>
        <a href="${ACTION_LIST_URL}/abcdef0123456789abcdef01">${DOCUMENT_NUMBER}</a>`,
    }));
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);

    await assert.rejects(
      driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER }),
      /Kuali Action List lookup for document 123456.*outcome is unknown/u,
    );
  }, 25_000);

  it("reports a different saved number as a conflict requiring review", async () => {
    await context.route(DOCUMENT_URL, route => route.fulfill({
      contentType: "text/html",
      body: documentForm("T009991122"),
    }));
    await page.goto(DOCUMENT_URL);
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);

    const verdict = kualiFinalizationVerdict(TARGET, await driver.readSavedSeparationFinalization(TARGET));
    assert.equal(verdict.state, "unknown");
    assert.match(verdict.reason, /finalization conflict.*different saved transaction number.*review/iu);
  });

  it("refuses to stage if partial finalization appears after a proved absence", async () => {
    let payrollTitle = "";
    const { driver } = await setupActionList();
    await context.route(DOCUMENT_URL, route => route.fulfill({
      contentType: "text/html",
      body: documentForm("", payrollTitle),
    }));
    await page.goto(DOCUMENT_URL);
    assert.equal(kualiFinalizationVerdict(TARGET, await driver.readSavedSeparationFinalization(TARGET)).state, "absent");

    payrollTitle = "Prior title";
    await assert.rejects(driver.stageSeparationFinalization(TARGET), /finalization conflict.*partial.*review/iu);
    assert.equal(await page.getByRole("textbox", { name: "Payroll Title*" }).inputValue(), "Prior title");
    const verdict = kualiFinalizationVerdict(TARGET, await driver.readSavedSeparationFinalization(TARGET));
    assert.equal(verdict.state, "unknown");
    assert.match(verdict.reason, /finalization conflict.*partial.*review/iu);
  });

  it("refuses to stage if the fresh Action List shows a different action for the document", async () => {
    const { driver } = await setupActionList({
      edges: [actionListEdge(DOCUMENT_NUMBER, "abcdef0123456789abcdef01")],
    });
    await assert.rejects(driver.stageSeparationFinalization(TARGET), /staging could not verify the requested action/u);
    assert.equal(page.url(), ACTION_LIST_URL);
  });

  it("blocks a Save for a different action before the request is forwarded", async () => {
    const variables = { ...saveVariables(), actionId: "abcdef0123456789abcdef01" };
    const fixture = await stageSave(variables);
    await assert.rejects(fixture.commit(), /save targeted action/iu);
    assert.deepEqual(fixture.forwarded, []);

    const retry = await page.evaluate(({ url, payload }) => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(() => "answered", () => "aborted"), { url: GRAPHQL_URL, payload: fixture.payload });
    assert.equal(retry, "aborted");
    assert.deepEqual(fixture.forwarded, []);
  });

  it("blocks a Save missing a staged field before the request is forwarded", async () => {
    const variables = saveVariables();
    delete variables.data["wPyuyY0wT0"];
    const fixture = await stageSave(variables);
    await assert.rejects(fixture.commit(), /staged.*(?:transactionNumber|wPyuyY0wT0)/iu);
    assert.deepEqual(fixture.forwarded, []);
  });

  it("blocks a Save for a different document ID even when the action ID matches", async () => {
    const fixture = await stageSave({ ...saveVariables(), documentId: "another-document-id" });
    await assert.rejects(fixture.commit(), /save targeted a different document ID/iu);
    assert.deepEqual(fixture.forwarded, []);
    assert.equal(fixture.lookups.length, 1);
  });

  it("blocks a submission that would advance the workflow", async () => {
    const fixture = await stageSave({ ...saveVariables(), status: "submitted" });
    await assert.rejects(fixture.commit(), /save status/u);
    assert.deepEqual(fixture.forwarded, []);
  });

  it.each([
    ["a missing executable document", ""],
    ["a mislabeled mutation", SAVE_QUERY.replace("  submitDocumentV2(", "  advanceDocument(")],
    ["an additional root mutation", `${SAVE_QUERY.slice(0, -1)}  advanceDocument { status }\n}`],
    ["a substituted action argument", SAVE_QUERY.replace("actionId: $actionId", "actionId: $documentId")],
  ])("blocks %s before forwarding", async (_description, query) => {
    const fixture = await stageSave(saveVariables(), query);
    await assert.rejects(fixture.commit(), /save shape|Save operation/u);
    assert.deepEqual(fixture.forwarded, []);
  });

  it("blocks unexpected variables in the Save envelope", async () => {
    const variables = { ...saveVariables(), extensions: { unexpected: true } };
    const fixture = await stageSave(variables);
    await assert.rejects(fixture.commit(), /save shape/u);
    assert.deepEqual(fixture.forwarded, []);
  });

  it("forwards one valid Save and still requires persisted values after reload", async () => {
    const variables = saveVariables();
    const fixture = await stageSave(variables);
    assert.equal((await fixture.commit()).performed, true);
    assert.deepEqual(fixture.forwarded, [fixture.payload]);
    assert.equal(kualiFinalizationVerdict(TARGET, await fixture.driver.readSavedSeparationFinalization(TARGET)).state, "absent");
  });
});

describe("Kuali response deadline", () => {
  let stalledBrowser: Browser;
  let server: Server;
  let headersSent = false;
  // Headers arrive at once; the jump puts the operation past its deadline so only the body wait remains.
  const jumpingClock: Clock = { ...systemClock, monotonicMs: () => performance.now() + (headersSent ? 120_000 : 0) };

  beforeAll(async () => {
    await using directory = await mkdtempDisposable(join(tmpdir(), "relay-kuali-"));
    const key = join(directory.path, "key.pem"), cert = join(directory.path, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
      "-keyout", key, "-out", cert], { stdio: "ignore" });
    server = createSecureServer({ key: await readFile(key), cert: await readFile(cert) }, (_request, response) => {
      headersSent = true;
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"data":');
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    stalledBrowser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--ignore-certificate-errors",
      `--host-resolver-rules=MAP ucsd.kualibuild.com 127.0.0.1:${String(address.port)}, MAP * ~NOTFOUND`] });
  });
  afterAll(async () => {
    await stalledBrowser?.close();
    server?.closeAllConnections();
    await new Promise(resolve => server?.close(resolve));
  });
  beforeEach(async () => {
    headersSent = false;
    await context.close();
    context = await stalledBrowser.newContext({ serviceWorkers: "block" });
    page = await context.newPage();
  });

  it("ends an Action List read whose body never finishes at the deadline", async () => {
    const { driver } = await setupActionList({ clock: jumpingClock });
    await context.route(GRAPHQL_URL, route => route.continue());
    await assert.rejects(driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER }), (error: unknown) => {
      assert.ok(error instanceof Error && error.cause instanceof Error);
      assert.match(error.message, /outcome is unknown/u);
      assert.match(error.cause.message, /did not finish its body by the deadline/u);
      return true;
    });
    assert.ok(headersSent);
    assert.ok(page.isClosed());
  });

  it("ends a forwarded Save whose body never finishes at the deadline as unknown", async () => {
    const fixture = await stageSave(saveVariables(), SAVE_QUERY, jumpingClock);
    await context.route(GRAPHQL_URL, async route => {
      const received: unknown = route.request().postDataJSON();
      if (typeof received === "object" && received !== null && "operationName" in received
        && received.operationName === "submitDocumentV2") await route.continue();
      else await route.fallback();
    });
    await assert.rejects(fixture.commit(), /deadline.*outcome is unknown/u);
    assert.ok(headersSent);
    assert.ok(page.isClosed());
  });
});
