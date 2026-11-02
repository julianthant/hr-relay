import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import type { Page } from "playwright";
import { ONBASE_DOCUMENT_NAME, ONBASE_DOCUMENT_TYPE } from "../../../../src/models/systems/onbase/import-document.js";

export interface SavedOnbaseFixture { id: string; eid: string; bytes: Uint8Array; href?: string }
export function fakeOnbasePage(options: { eid?: string; noMatch?: boolean; stalled?: boolean; blankDepartment?: boolean;
  saved?: SavedOnbaseFixture[]; incomplete?: boolean; lostClick?: boolean; queue?: number; foreignRoute?: boolean;
  ignoredFilter?: string; staleResults?: boolean; changeDuringDownload?: boolean; unreadablePdf?: boolean } = {}) {
  const actions: string[] = [], fields = new Map<string, string>(), queued: { name: string; buffer: Buffer }[] = [];
  const saved = [...options.saved ?? []];
  for (let index = 0; index < (options.queue ?? 0); index++) queued.push({ name: `leftover-${index}.pdf`, buffer: Buffer.from("old page") });
  let mode = "retrieval", modal = false, searched = false, found = false;
  const headers = ["Document ID", "Document Type", "UCPath ID", "Document Name", "File"];
  class FixtureInput { constructor(readonly value: string) {} }
  class Locator {
    constructor(readonly name: string, readonly scope = "page", readonly index = 0, readonly text?: string, readonly enabledOnly = false, readonly alternative?: Locator) {}
    getByRole(role: string, input: { name?: string | RegExp } = {}) { return new Locator(input.name === undefined ? role : String(input.name), this.name === "row" ? `row:${this.index}` : this.scope, this.index); }
    locator(selector: string) { return new Locator(selector === "option:checked" ? `selected:${this.name}` : selector, this.scope); }
    filter(input: { hasText?: string; has?: unknown }) { return new Locator(this.name, this.scope, this.index, input.hasText); }
    nth(index: number) { return new Locator(this.name, this.scope, index, this.text, this.enabledOnly, this.alternative); }
    first() { return this.nth(0); }
    and(_other: Locator) { return new Locator(this.name, this.scope, this.index, this.text, true); }
    or(other: Locator) { return new Locator(this.name, this.scope, this.index, this.text, this.enabledOnly, other); }
    visible(): boolean {
      if (this.alternative !== undefined) return this.singleVisible() || this.alternative.visible();
      return this.singleVisible();
    }
    singleVisible() {
      if (this.name === "Employee Lookup") return modal;
      if (this.name === "No matching records were found") return modal && found && options.noMatch === true;
      if (this.name === "Select Employee") return modal && found && !options.noMatch && !options.stalled;
      if (this.name === "status") return searched;
      if (this.name === "Remove") return this.index < queued.length;
      if (this.name === "row" && mode === "import") return queued.some(row => this.text === undefined || row.name.includes(this.text));
      return true;
    }
    async waitFor(input: { state: string }) { assert.equal(this.visible(), input.state !== "hidden", `${this.name} did not become ${input.state}`); }
    async count() {
      if (this.name === "Remove") return queued.length;
      if (this.name === "row") return mode === "import" ? queued.filter(row => this.text === undefined || row.name.includes(this.text)).length : saved.length;
      return this.visible() ? 1 : 0;
    }
    async isVisible() { return this.visible(); }
    async isEnabled() { return this.visible(); }
    async inputValue() { return fields.get(`${this.scope}:${this.name}`) ?? ""; }
    async fill(value: string) { if (this.name !== options.ignoredFilter) fields.set(`${this.scope}:${this.name}`, value); actions.push(`fill:${this.scope}:${this.name}`); }
    async selectOption(input: { label: string }) { fields.set(`${this.scope}:${this.name}`, input.label); actions.push(`select:${input.label}`); return [input.label]; }
    async click() {
      actions.push(`click:${this.name}`);
      if (this.name === "Import Document" || this.name === "Document Retrieval") { mode = this.name === "Import Document" ? "import" : "retrieval"; searched = options.staleResults === true; }
      if (this.name === "Remove") queued.splice(this.index, 1);
      if (this.name === "Clear Keywords") for (const name of ["UCPath ID", "Last Name", "First Name", "Document Name", "Department Name", "Department Code", "Vice Chancellor", "Vice Chancellor Code"]) fields.delete(`form:${name}`);
      if (this.name === "Keyset Lookup") modal = true;
      if (this.name === "Find") { if (this.scope === "lookup") found = true; else searched = true; }
      if (this.name === "Select Employee") {
        modal = false;
        for (const [name, value] of Object.entries({ "UCPath ID": options.eid ?? fields.get("lookup:UCPath ID"), "Last Name": "Example", "First Name": "Person",
          "Department Name": options.blankDepartment ? "" : "Example Department", "Department Code": "000001", "Vice Chancellor": "Example Division", "Vice Chancellor Code": "EX" })) fields.set(`form:${name}`, value ?? "");
      }
      if (this.name === "Import") {
        assert.equal(queued.length, 1);
        saved.push({ id: String(900001 + saved.length), eid: fields.get("form:UCPath ID") ?? "", bytes: queued[0]?.buffer ?? Buffer.alloc(0) });
        queued.length = 0;
        if (options.lostClick) throw new Error("import acknowledgement lost");
      }
    }
    async setInputFiles(file: { name: string; buffer: Buffer }) { queued.push(file); actions.push("upload"); }
    async elementHandle() { return new FixtureInput(await this.inputValue()); }
    async innerText() { return `${saved.length + (options.incomplete ? 1 : 0)} documents found`; }
    async allTextContents() {
      if (this.name.startsWith("selected:")) { const selected = fields.get(`${this.scope}:${this.name.slice(9)}`); return selected === undefined ? [] : [selected]; }
      if (this.name === "columnheader") return headers;
      const row = saved[this.index]; assert.ok(row);
      return [row.id, ONBASE_DOCUMENT_TYPE, row.eid, ONBASE_DOCUMENT_NAME, "Download"];
    }
    async getAttribute(name: string) { assert.equal(name, "href"); const row = saved[this.index]; assert.ok(row); return row.href ?? `/251ids/download.pdf?id=${row.id}`; }
  }
  const page = {
    on() {},
    url: () => options.foreignRoute ? "https://example.test/NavPanel.aspx" : "https://ucsd.hylandcloud.com/251ids/NavPanel.aspx",
    getByRole: (_role: string, input: { name: string }) => new Locator(input.name),
    getByText: (text: string) => new Locator(text),
    locator: (text: string) => new Locator(text),
    frameLocator: (selector: string) => ({
      getByRole: (role: string, input?: { name: string }) => new Locator(input?.name ?? role, selector.includes("ReverseKeyset") ? "lookup" : selector.includes("frmViewer") ? "viewer" : "form"),
      locator: (text: string) => new Locator(text, "form"),
    }),
    async waitForFunction(callback: (element: { value: string }) => boolean, element: { value: string }) { assert.equal(runInNewContext(`(${callback.toString()})(element)`, { HTMLInputElement: FixtureInput, element }), true); },
    context: () => ({ request: { async get(href: string) {
      const id = new URL(href).searchParams.get("id"), row = saved.find(value => value.id === id); assert.ok(row); actions.push(`download:${id}`);
      if (options.changeDuringDownload) fields.set("form:UCPath ID", "10800001");
      return { ok: () => !options.unreadablePdf, headers: () => ({ "content-type": "application/pdf" }), body: async () => Buffer.from(row.bytes), dispose: async () => undefined };
    } } }),
  };
  return { page: page as unknown as Page, actions, fields, queued, saved };
}
