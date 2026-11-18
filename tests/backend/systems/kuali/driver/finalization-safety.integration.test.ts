import assert from "node:assert/strict";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { createKualiRrssDocumentDriver } from "../../../../../src/backend/systems/kuali/driver/interpreter.js";
import { KUALI_RRSS_SPACE_ID } from "../../../../../src/backend/systems/kuali/driver/ui-registry.js";
import { kualiFinalizationVerdict } from "../../../../../src/backend/systems/kuali/finalization-verdict.js";
import { KUALI_RRSS_SAVE_BUTTON } from "../../../../../src/models/ui/kuali-rrss-document.js";
import { KualiFinalizationTargetSchema } from "../../../../../src/models/ui/kuali-separation-finalization.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import { kualiFinalizationVariablesInput } from "../../../../support/helpers/kuali-finalization-input-fixtures.js";

const ACTION_LIST_URL = `https://ucsd.kualibuild.com/build/space/${KUALI_RRSS_SPACE_ID}/actions`;
const DOCUMENT_NUMBER = "123456";
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
const SAVE_QUERY = `mutation submitDocumentV2(
  $documentId: ID!, $actionId: ID!, $data: JSON!, $status: String!, $timeZone: String
) {
  submitDocumentV2(documentId: $documentId, actionId: $actionId, data: $data, status: $status, timeZone: $timeZone) {
    status
    validations
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

function saveVariables(): { actionId: string; status: string; data: Record<string, unknown>; documentId: string; timeZone: string } {
  return {
    actionId: TARGET.actionId,
    documentId: "fixture-document-id",
    status: "saved",
    timeZone: "America/Los_Angeles",
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

async function stageSave(variables: ReturnType<typeof saveVariables>, query = SAVE_QUERY) {
  const payload = { operationName: "submitDocumentV2", query, variables };
  const forwarded: unknown[] = [];
  await context.route(DOCUMENT_URL, route => route.fulfill({
    contentType: "text/html",
    body: documentForm(),
  }));
  await context.route(GRAPHQL_URL, async route => {
    forwarded.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { submitDocumentV2: { status: "Ok", validations: null } } } });
  });
  const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);
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
  const capability = mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)));
  return { driver, forwarded, payload, commit: () => driver.commit(KUALI_RRSS_SAVE_BUTTON, capability) };
}

describe("Kuali finalization safety", () => {
  it("resolves a filtered result by its exact document number", async () => {
    await context.route(ACTION_LIST_URL, route => route.fulfill({
      contentType: "text/html",
      body: `
        <input aria-label="Search">
        <button onclick="document.querySelector('#match').hidden = false; document.querySelector('#neighbor').remove()">GO</button>
        <a id="neighbor" href="/neighbor">654321</a>
        <a id="match" href="${DOCUMENT_URL}" hidden>${DOCUMENT_NUMBER}</a>`,
    }));
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);

    const observation = await driver.readActionListForDocument({ documentNumber: DOCUMENT_NUMBER });
    assert.deepEqual(observation.matchedLinks, [{ name: DOCUMENT_NUMBER, href: DOCUMENT_URL }]);
  });

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
    await context.route(DOCUMENT_URL, route => route.fulfill({
      contentType: "text/html",
      body: documentForm("", payrollTitle),
    }));
    await page.goto(DOCUMENT_URL);
    const driver = createKualiRrssDocumentDriver(() => undefined, page, systemClock);
    assert.equal(kualiFinalizationVerdict(TARGET, await driver.readSavedSeparationFinalization(TARGET)).state, "absent");

    payrollTitle = "Prior title";
    await assert.rejects(driver.stageSeparationFinalization(TARGET), /finalization conflict.*partial.*review/iu);
    assert.equal(await page.getByRole("textbox", { name: "Payroll Title*" }).inputValue(), "Prior title");
    const verdict = kualiFinalizationVerdict(TARGET, await driver.readSavedSeparationFinalization(TARGET));
    assert.equal(verdict.state, "unknown");
    assert.match(verdict.reason, /finalization conflict.*partial.*review/iu);
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

  it("blocks a submission that would advance the workflow", async () => {
    const fixture = await stageSave({ ...saveVariables(), status: "submitted" });
    await assert.rejects(fixture.commit(), /save status/u);
    assert.deepEqual(fixture.forwarded, []);
  });

  it.each([
    ["a missing executable document", ""],
    ["a mislabeled mutation", SAVE_QUERY.replace("  submitDocumentV2(", "  advanceDocument(")],
    ["an additional root mutation", SAVE_QUERY.replace("    __typename\n  }", "    __typename\n  }\n  advanceDocument { status }")],
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
