import { planEmergencyContact, contactEffect } from "../../../../../src/rules/ucpath/emergency-contact.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { describe, it } from "vitest";
import fixture from "../../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { createUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import { UcpathEmergencyContactInputSchema, UcpathContactRefusedError } from "../../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UCPATH_CONTACT_DISPLAYED_NAME, UcpathContactPageSnapshotSchema } from "../../../../../src/models/ui/ucpath-emergency-contact.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { UCPATH_PENDING_CONTACT_RECIPES as recipes } from "../../../../../src/backend/systems/ucpath/driver/ui-registry.js";

const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
assert.ok(input.contact.address.kind === "explicit");
// The synthetic blank panel displays an empty Country; preparation cannot change it.
input.contact.address.fields.country = null;
const template = readFileSync(new URL("../../../../support/fixtures/ui/ucpath/emergency-contact.html", import.meta.url), "utf8");

async function browserFixture(options: {
  foreign?: boolean; changeProtected?: boolean; loseName?: boolean; insert?: boolean;
  address?: boolean; disabledViewAll?: boolean; totalRows?: number;
} = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const data = { ...structuredClone(fixture), page: UcpathContactPageSnapshotSchema.parse(fixture.page) };
  if (options.foreign) data.page.displayedEid = "10000002";
  if (options.insert) data.page.rows = data.page.rows.slice(0, 1);
  if (options.address) data.page.rows[0].address = structuredClone(data.savedRow.address);
  const body = template.replace("__FIXTURE__", JSON.stringify({ ...data, ...options }));
  const navigations: string[] = [];
  await page.route("**/*", route => { navigations.push(new URL(route.request().url()).pathname); return route.fulfill({ contentType: "text/html", body }); });
  await page.goto("https://ucphrprdpub.universityofcalifornia.edu/");
  let active = true;
  const driver = createUcpathPersonOrgDriver(() => { if (!active) throw new Error("owner-revoked"); }, page,
    manualClock(new Date("2026-11-02T12:00:00.000Z")));
  return { browser, page, driver, navigations, revoke: () => { active = false; } };
}

async function events(page: Awaited<ReturnType<typeof browserFixture>>["page"]) {
  return page.evaluate(() => {
    const state = Reflect.get(window, "contactFixtureState") as { saves: number; actions: string[] };
    return { saves: state.saves, actions: state.actions };
  });
}

describe("production UCPath contact driver on a synthetic browser page", () => {
  it("reads the captured one-row structure with a begins-with search label, ID-less counter and disabled View All", async () => {
    const h = await browserFixture({ insert: true, address: true });
    try {
      assert.equal(await h.page.getByRole("textbox", { name: "Empl ID", exact: true }).count(), 0);
      assert.equal(await h.page.getByRole("textbox", { name: "Empl ID begins with", exact: true }).count(), 1);
      const before = await h.driver.readEmergencyContacts(input);
      assert.equal(before.rowCount, 1);
      assert.equal(before.viewAll, "already-complete");
      const row = before.rows[0];
      assert.ok(row?.kind === "contact" && row.effect.address.kind === "explicit");
      assert.deepEqual(row.effect.address.fields, fixture.savedRow.address);
      assert.equal(await h.page.locator('[id="$ICField2$hrow$0"], [id="$ICField2$hviewall$0"]').count(), 0);
      assert.equal(await h.page.locator('[id="$ICField2$scrolli$0"] span.PSGRIDCOUNTER').innerText(), "1 of 1");
      assert.equal(await h.page.getByRole("link", { name: "View All", exact: true }).count(), 0);
      assert.equal(await h.page.locator(recipes.readOnlyControls.samePhoneAsEmployee).isChecked(), fixture.readOnlyControls.samePhoneAsEmployee);
      const observed = await events(h.page);
      assert.deepEqual(observed, { saves: 0, actions: ["address:0"] });
      await h.page.locator('[id="DERIVED_ADDR_UPDATE_ADDRESS$0"]').click();
      assert.equal(await h.page.getByRole("textbox", { name: "Country", exact: true }).count(), 0);
      assert.equal(await h.page.locator('span[id^="DERIVED_ADDRESS_COUNTRY$"]').innerText(), fixture.savedRow.address.country);
      assert.equal(await h.page.locator(recipes.readOnlyControls.address3).inputValue(), fixture.readOnlyControls.address3);
      assert.equal(await h.page.locator(recipes.readOnlyControls.county).inputValue(), fixture.readOnlyControls.county);
      await h.page.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally { await h.browser.close(); }
  });

  it("refuses an incomplete set when View All is disabled", async () => {
    const h = await browserFixture({ insert: true, disabledViewAll: true, totalRows: 2 });
    try {
      await assert.rejects(h.driver.readEmergencyContacts(input), (error: unknown) =>
        error instanceof UcpathContactRefusedError && error.code === "contact-set-incomplete");
      assert.deepEqual(await events(h.page), { saves: 0, actions: ["address:0"] });
    } finally { await h.browser.close(); }
  });

  it("refuses a different requested Country without filling the display or accepting the address panel", async () => {
    const h = await browserFixture();
    try {
      const requested = UcpathEmergencyContactInputSchema.parse(fixture.input);
      const before = await h.driver.readEmergencyContacts(requested);
      await assert.rejects(h.driver.stageEmergencyContact(requested, planEmergencyContact(before, contactEffect(requested))),
        (error: unknown) => error instanceof UcpathContactRefusedError && error.code === "staged-effect-mismatch");
      const observed = await events(h.page);
      assert.equal(observed.saves, 0);
      assert.ok(!observed.actions.some(action => /^(address-ok|name|address3|county|same-phone):/u.test(action)));
      assert.equal(await h.page.getByRole("textbox", { name: "Address 1", exact: true }).count(), 0);
    } finally { await h.browser.close(); }
  });

  it("enters by employee search and reloads persisted contacts for two same-person primary previews", async () => {
    const h = await browserFixture(), primary = { ...input, contact: { ...input.contact, primary: true } };
    try {
      for (let preview = 0; preview < 2; preview++) {
        const before = await h.driver.readEmergencyContacts(primary);
        assert.equal(before.observation, "persisted");
        assert.equal(before.rows.filter(row => row.kind === "contact").length, 1);
        const plan = planEmergencyContact(before, contactEffect(primary));
        const staged = await h.driver.stageEmergencyContact(primary, plan);
        assert.equal(staged.observation, "staged");
        assert.deepEqual(staged.rows.map(row => row.kind === "contact" ? row.effect.primary : null), [false, true]);
        assert.equal((await events(h.page)).saves, 0);
        const searches = await h.page.evaluate(() => {
          const state: unknown = Reflect.get(window, "contactFixtureState");
          if (typeof state !== "object" || state === null) throw new Error("contact-fixture-state-missing");
          const searches: unknown = Reflect.get(state, "searches");
          return searches;
        });
        assert.deepEqual(searches, [input.emplId]);
      }
      assert.equal(h.navigations.length, 5);
      assert.ok(h.navigations.slice(1).every(path => path.includes("EMERGENCY_CONTACT")));
    } finally { await h.browser.close(); }
  });
  for (const insert of [false, true]) {
    it(`stages the exact complete contact effect with ${insert ? "inserted" : "reused blank"} row and no Save`, async () => {
      const h = await browserFixture({ insert });
      try {
        const before = await h.driver.readEmergencyContacts(input);
        assert.equal(before.viewAll, insert ? "already-complete" : "expanded");
        assert.equal(before.displayedName, input.expectedName);
        const staged = await h.driver.stageEmergencyContact(input, planEmergencyContact(before, contactEffect(input)));
        assert.equal(staged.observation, "staged");
        assert.equal(staged.rows.filter(row => row.kind === "contact").length, 2);
        assert.equal(await h.driver.read(UCPATH_CONTACT_DISPLAYED_NAME), input.expectedName);
        const observed = await events(h.page);
        assert.equal(observed.saves, 0);
        assert.ok(!observed.actions.some(action => /^(address3|county|same-phone|disabled-view-all):/u.test(action)));
        assert.equal(observed.actions.includes("add-row"), insert);
        const target = insert ? 0 : 1;
        const row = staged.rows[target];
        assert.ok(row?.kind === "contact");
        assert.equal(row.effect.name, input.contact.name);
        assert.deepEqual(row.effect.address, input.contact.address);
        const mutations = observed.actions.filter(action => /^(primary|relationship|sameAddressAsEmployee|phone|name|address-ok):/u.test(action));
        assert.equal(mutations.at(-1), `name:${target}`);
      } finally { await h.browser.close(); }
    });
  }

  it("refuses independently observed foreign identity before contact address reads or filling", async () => {
    const h = await browserFixture({ foreign: true });
    try {
      await assert.rejects(h.driver.readEmergencyContacts(input), (error: unknown) => error instanceof UcpathContactRefusedError && error.code === "contact-subject-mismatch");
      assert.deepEqual(await events(h.page), { saves: 0, actions: [] });
    } finally { await h.browser.close(); }
  });

  for (const options of [{ changeProtected: true }, { loseName: true }]) {
    it(`refuses a ${"loseName" in options ? "lost name" : "changed protected primary"} without saving`, async () => {
      const h = await browserFixture(options);
      try {
        const before = await h.driver.readEmergencyContacts(input);
        await assert.rejects(h.driver.stageEmergencyContact(input, planEmergencyContact(before, contactEffect(input))), UcpathContactRefusedError);
        assert.equal((await events(h.page)).saves, 0);
      } finally { await h.browser.close(); }
    });
  }

  it("checks current ownership before navigation", async () => {
    const h = await browserFixture();
    try {
      h.revoke();
      await assert.rejects(h.driver.readEmergencyContacts(input), /owner-revoked/u);
      assert.deepEqual(await events(h.page), { saves: 0, actions: [] });
    } finally { await h.browser.close(); }
  });
});
