import { assertContactSubject } from "../../../../rules/ucpath/emergency-contact.js";
import type { Locator, Page } from "playwright";
import type { Clock } from "../../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { UcpathContactAddressFieldsSchema, UcpathContactRefusedError } from "../../../../models/systems/ucpath/emergency-contacts.js";
import type { UcpathEmergencyContactInput } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageSnapshotSchema } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPageSnapshot } from "../../../../models/ui/ucpath-emergency-contact.js";
import { createContactOperations, interpretContactPage } from "./contact-operation.js";
import type { UcpathContactPagePort } from "./contact-operation.js";
import { UCPATH_PENDING_CONTACT_RECIPES as recipes } from "./ui-registry.js";
import type { UcpathEmergencyContactDriver } from "../../../../models/ui/ucpath-emergency-contact.js";

export function createUcpathContactOperations(assertCurrent: () => void, page: Page, clock: Clock): UcpathEmergencyContactDriver {
  async function current<T>(action: () => Promise<T>): Promise<T> {
    assertCurrent();
    try {
      const result = await action();
      assertCurrent();
      return result;
    } catch (cause) {
      assertCurrent();
      throw new UcpathContactRefusedError("unexpected-contact-page", { cause });
    }
  }
  const rowField = (key: keyof typeof recipes.rowFields, index: number): Locator =>
    page.locator(`[id="${recipes.rowFields[key]}$${String(index)}"]${key === "primary" || key === "sameAddressAsEmployee" ? '[type="checkbox"]' : ""}`);
  const addressField = (label: string): Locator => page.getByRole("textbox", { name: label, exact: true });

  async function settle(): Promise<void> {
    await current(() => page.locator(recipes.busy).waitFor({ state: "hidden", timeout: 10_000 }));
    await current(() => page.waitForLoadState("networkidle", { timeout: 10_000 }));
  }

  async function core() {
    return current(() => page.evaluate((r) => {
      const text = (selector: string): string => {
        const elements = document.querySelectorAll(selector);
        if (elements.length !== 1) throw new Error("contact display is missing or ambiguous");
        return elements[0]?.textContent?.trim() ?? "";
      };
      const field = (key: keyof typeof r.rowFields, index: number): HTMLInputElement | HTMLSelectElement => {
        const checkbox = key === "primary" || key === "sameAddressAsEmployee";
        const nodes = document.querySelectorAll(`[id="${r.rowFields[key]}$${String(index)}"]${checkbox ? '[type="checkbox"]' : ""}`);
        const element = nodes[0];
        if (nodes.length !== 1 || !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
          throw new Error("contact row field is missing or ambiguous");
        }
        return element;
      };
      const checked = (key: "primary" | "sameAddressAsEmployee", index: number): boolean => {
        const element = field(key, index);
        if (!(element instanceof HTMLInputElement) || element.type !== "checkbox") throw new Error("contact checkbox is unreadable");
        return element.checked;
      };
      const counter = text(r.counter).match(/^(?:\d+\s*-\s*)?\d+\s+of\s+(\d+)$/iu);
      if (counter?.[1] === undefined) throw new Error("contact row count is unreadable");
      const toggles = [...document.querySelectorAll(r.viewToggle)].filter(node => /^View\s/iu.test(node.textContent?.trim() ?? ""));
      if (toggles.length > 1) throw new Error("contact view state is ambiguous");
      const toggle = toggles[0];
      const toggleText = toggle?.textContent?.trim();
      if (toggleText !== undefined && !/^View (?:All|\d+)$/iu.test(toggleText)) throw new Error("contact view state is unreadable");
      const canExpand = toggle instanceof HTMLAnchorElement && toggle.hasAttribute("href")
        && toggle.getAttribute("aria-disabled") !== "true" && toggleText?.toLowerCase() === "view all";
      return {
        displayedEid: text(r.displayedEid), displayedName: text(r.displayedName),
        view: canExpand ? "paged" as const : "all" as const,
        totalRows: Number(counter[1]),
        rows: [...document.querySelectorAll(r.names)].map((node) => {
          const index = Number(node.id.slice(node.id.lastIndexOf("$") + 1));
          if (!Number.isSafeInteger(index) || index < 0) throw new Error("contact index is unreadable");
          const relation = field("relationship", index);
          if (!(relation instanceof HTMLSelectElement) || relation.selectedOptions.length !== 1) throw new Error("contact relationship is unreadable");
          const name = field("name", index).value;
          const phone = field("phone", index).value;
          const label = relation.selectedOptions[0]?.label.trim() ?? "";
          return {
            rowIndex: index, name, phone,
            relationship: name.trim() === "" && phone.trim() === "" && label === "(Invalid Value)" ? "" : label,
            primary: checked("primary", index), sameAddressAsEmployee: checked("sameAddressAsEmployee", index),
          };
        }),
      };
    }, recipes));
  }

  function port(subject: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">): UcpathContactPagePort {
    let observation: UcpathContactPageSnapshot["observation"] = "persisted";
    let baseline: Awaited<ReturnType<typeof core>> | undefined;

    async function assertTarget(index: number): Promise<void> {
      const raw = await core();
      assertContactSubject({ ...raw, pageStateId: "ucpath.emergency-contact.editor-ready" }, subject);
      if (baseline === undefined || raw.view !== "all"
        || raw.rows.length !== raw.totalRows || raw.rows.some((row, i) => row.rowIndex !== i)
        || raw.rows[index]?.name.trim() !== ""
        || canonicalJsonStringify(raw.rows.filter(row => row.rowIndex !== index))
          !== canonicalJsonStringify(baseline.rows.filter(row => row.rowIndex !== index))) throw new UcpathContactRefusedError("contact-set-changed");
    }

    async function readAddress(index: number) {
      await current(() => rowField("editAddress", index).click());
      await current(() => addressField(recipes.addressFields[0][1]).waitFor({ state: "visible", timeout: 10_000 }));
      const values = await current(() => Promise.all(recipes.addressFields.map(async ([key, label]) => {
        return [key, (await addressField(label).inputValue()).trim() || null] as const;
      })));
      const country = await current(() => page.locator(recipes.countryDisplay).innerText());
      await current(() => page.getByRole("button", { name: "Cancel", exact: true }).click());
      await current(() => addressField(recipes.addressFields[0][1]).waitFor({ state: "hidden", timeout: 10_000 }));
      await settle();
      if (values.every(([, value]) => value === null) && country.trim() === "") return null;
      const address = UcpathContactAddressFieldsSchema.safeParse({ ...Object.fromEntries(values), country: country.trim() || null });
      if (!address.success) throw new UcpathContactRefusedError("unreadable-contact-row", { cause: address.error });
      return address.data;
    }

    async function snapshot() {
        const before = await core();
        assertContactSubject({ ...before, pageStateId: "ucpath.emergency-contact.editor-ready" }, subject);
        const rows = [];
        for (const row of before.rows) {
          const address = await readAddress(row.rowIndex);
          rows.push({ ...row, address });
        }
        if (canonicalJsonStringify(before) !== canonicalJsonStringify(await core())) {
          throw new UcpathContactRefusedError("contact-set-changed");
        }
        const parsed = UcpathContactPageSnapshotSchema.safeParse({
          ...before, rows, pageStateId: "ucpath.emergency-contact.editor-ready", observation, observedAt: clock.now().toISOString(),
        });
        if (!parsed.success) throw new UcpathContactRefusedError("unreadable-contact-row", { cause: parsed.error });
        baseline = before;
        return parsed.data;
    }
    return {
      snapshot,
      async demotePrimary(index, expected) {
        const before = interpretContactPage(await snapshot(), subject);
        const matches = before.rows.filter(row => row.kind === "contact" && canonicalJsonStringify(row.effect) === canonicalJsonStringify(expected));
        if (!expected.primary || matches.length !== 1 || matches[0]?.rowIndex !== index) throw new UcpathContactRefusedError("contact-set-changed");
        observation = "staged";
        await current(() => rowField("primary", index).setChecked(false));
        await settle();
      },
      async viewAll() {
        await current(() => page.locator(recipes.grid).getByRole("link", { name: "View All", exact: true }).click());
        await settle();
      },
      async addBlankRow() {
        observation = "staged";
        await current(() => page.getByRole("button", { name: /add a new row/iu }).click());
        await settle();
        if ((await core()).view === "paged") {
          await current(() => page.locator(recipes.grid).getByRole("link", { name: "View All", exact: true }).click());
          await settle();
        }
      },
      async fillFields(index, effect) {
        observation = "staged";
        await assertTarget(index);
        await current(() => rowField("primary", index).setChecked(effect.primary));
        await settle();
        await assertTarget(index);
        await current(() => rowField("relationship", index).selectOption({ label: effect.relationship }));
        await settle();
        await assertTarget(index);
        await current(() => rowField("sameAddressAsEmployee", index).setChecked(effect.address.kind === "same-as-employee"));
        await settle();
        await assertTarget(index);
        if (effect.address.kind === "explicit") {
          await current(() => rowField("editAddress", index).click());
          await current(() => addressField(recipes.addressFields[0][1]).waitFor({ state: "visible", timeout: 10_000 }));
          const country = await current(() => page.locator(recipes.countryDisplay).innerText());
          if ((country.trim() || null) !== effect.address.fields.country) {
            await current(() => page.getByRole("button", { name: "Cancel", exact: true }).click());
            await settle();
            throw new UcpathContactRefusedError("staged-effect-mismatch");
          }
          for (const [key, label] of recipes.addressFields) {
            const value = effect.address.fields[key];
            await current(() => addressField(label).fill(value ?? ""));
          }
          await current(() => page.getByRole("button", { name: "OK", exact: true }).click());
          await current(() => addressField(recipes.addressFields[0][1]).waitFor({ state: "hidden", timeout: 10_000 }));
          await settle();
        }
        await assertTarget(index);
        await current(() => rowField("phone", index).fill(effect.phone ?? ""));
      },
      async fillName(index, name) {
        await assertTarget(index);
        observation = "staged";
        await current(() => rowField("name", index).fill(name));
      },
    };
  }

  async function open(input: Pick<UcpathEmergencyContactInput, "emplId" | "expectedName">) {
    assertCurrent();
    const url = new URL(page.url());
    if (url.protocol !== "https:" || url.hostname !== "ucphrprdpub.universityofcalifornia.edu") {
      throw new UcpathContactRefusedError("unexpected-contact-page");
    }
    await current(() => page.goto(new URL(recipes.path, url.origin).href, { waitUntil: "domcontentloaded" }));
    await current(() => page.locator(recipes.searchEid).fill(input.emplId));
    await current(() => page.getByRole("button", { name: "Search", exact: true }).click());
    await current(() => page.locator(recipes.displayedEid).waitFor({ state: "visible", timeout: 10_000 }));
    return port(input);
  }

  return createContactOperations(open);
}
