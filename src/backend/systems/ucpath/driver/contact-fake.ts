import { EidSchema } from "../../../../rules/identity/ids.js";
import { UcpathContactPageSnapshotSchema } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPageSnapshot } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPagePort, UcpathContactSavePort } from "./contact-operation.js";
import { createContactOperations, interpretContactPage } from "./contact-operation.js";
import { UcpathContactRefusedError } from "../../../../models/systems/ucpath/emergency-contacts.js";
import type { UcpathEmergencyContactDriver } from "../../../../models/ui/ucpath-emergency-contact.js";

export function deterministicContactOperations(port?: UcpathContactPagePort, save?: UcpathContactSavePort): UcpathEmergencyContactDriver {
  return createContactOperations(async () => {
    if (port === undefined) throw new Error("UCPath fixture requires explicit contact page observations");
    return port;
  }, save);
}

export function createDeterministicUcpathContactPage(options: Readonly<{
  initial: UcpathContactPageSnapshot;
  expanded?: UcpathContactPageSnapshot;
  afterAdd?: UcpathContactPageSnapshot;
  afterFields?: UcpathContactPageSnapshot;
  afterName?: UcpathContactPageSnapshot;
}>): UcpathContactPagePort & { readonly actions: string[] } {
  let page = UcpathContactPageSnapshotSchema.parse(options.initial);
  const actions: string[] = [];
  return {
    actions,
    async snapshot() {
      actions.push("snapshot");
      return UcpathContactPageSnapshotSchema.parse(page);
    },
    async viewAll() {
      actions.push("view-all");
      if (options.expanded === undefined) throw new Error("contact fixture requires an explicit complete View All snapshot");
      page = UcpathContactPageSnapshotSchema.parse(options.expanded);
    },
    async demotePrimary(rowIndex, expected) {
      actions.push(`demote-primary:${rowIndex}`);
      const set = interpretContactPage(page, { emplId: EidSchema.parse(page.displayedEid), expectedName: page.displayedName });
      const row = set.rows.find(row => row.rowIndex === rowIndex);
      if (!expected.primary || row?.kind !== "contact" || JSON.stringify(row.effect) !== JSON.stringify(expected)
        || set.rows.filter(row => row.kind === "contact" && JSON.stringify(row.effect) === JSON.stringify(expected)).length !== 1) {
        throw new UcpathContactRefusedError("contact-set-changed");
      }
      page = { ...page, observation: "staged", rows: page.rows.map(row => row.rowIndex === rowIndex ? { ...row, primary: false } : row) };
    },
    async addBlankRow() {
      actions.push("add-row");
      page = options.afterAdd === undefined ? {
        ...page, observation: "staged", totalRows: page.totalRows + 1,
        rows: [
          { rowIndex: 0, name: "", relationship: "", phone: "", primary: false, sameAddressAsEmployee: false, address: null },
          ...page.rows.map(row => ({ ...row, rowIndex: row.rowIndex + 1 })),
        ],
      } : UcpathContactPageSnapshotSchema.parse(options.afterAdd);
    },
    async fillFields(rowIndex, effect) {
      actions.push(`fill-fields:${rowIndex}`);
      const row = page.rows[rowIndex];
      if (row === undefined || row.name.trim() !== "") throw new Error("contact fixture refuses to overwrite a populated row");
      page = {
        ...page, observation: "staged", rows: page.rows.map(value => value.rowIndex === rowIndex ? {
          ...value, relationship: effect.relationship, primary: effect.primary, phone: effect.phone ?? "",
          sameAddressAsEmployee: effect.address.kind === "same-as-employee",
          address: effect.address.kind === "unspecified" ? null : effect.address.fields,
        } : value),
      };
      if (options.afterFields !== undefined) page = UcpathContactPageSnapshotSchema.parse(options.afterFields);
    },
    async fillName(rowIndex, name) {
      actions.push(`fill-name:${rowIndex}`);
      const row = page.rows[rowIndex];
      if (row === undefined) throw new Error("contact fixture row disappeared");
      if (row.name.trim() !== "") throw new Error("contact fixture refuses to replace a populated name");
      page = { ...page, observation: "staged", rows: page.rows.map(row => row.rowIndex === rowIndex ? { ...row, name } : row) };
      if (options.afterName !== undefined) page = UcpathContactPageSnapshotSchema.parse(options.afterName);
    },
  };
}


/** Persistence belongs to the external fixture, independently of browser sessions. */
export function createDeterministicContactPersistence(initial: UcpathContactPageSnapshot, now: () => string) {
  let persisted = UcpathContactPageSnapshotSchema.parse(initial);
  const submissions: UcpathContactPageSnapshot[] = [];
  return {
    submissions,
    snapshot: () => UcpathContactPageSnapshotSchema.parse(persisted),
    replacePersisted: (snapshot: UcpathContactPageSnapshot) => { persisted = UcpathContactPageSnapshotSchema.parse(snapshot); },
    session() {
      let editor = createDeterministicUcpathContactPage({ initial: persisted });
      const port: UcpathContactPagePort = {
        async snapshot() {
          if ((await editor.snapshot()).observation === "persisted") {
            editor = createDeterministicUcpathContactPage({ initial: { ...persisted, observedAt: now() } });
          }
          return editor.snapshot();
        }, viewAll: () => editor.viewAll(), addBlankRow: () => editor.addBlankRow(),
        fillFields: (index, effect) => editor.fillFields(index, effect), fillName: (index, name) => editor.fillName(index, name),
        demotePrimary: (index, effect) => editor.demotePrimary(index, effect),
      };
      const save: UcpathContactSavePort = {
        async save() {
          const staged = await editor.snapshot();
          submissions.push(staged);
          persisted = UcpathContactPageSnapshotSchema.parse({ ...staged, observation: "persisted", observedAt: now() });
        },
        async readPersisted() {
          editor = createDeterministicUcpathContactPage({ initial: { ...persisted, observedAt: now() } });
          return interpretContactPage(await editor.snapshot(), { emplId: EidSchema.parse(persisted.displayedEid), expectedName: persisted.displayedName });
        },
      };
      return { port, save };
    },
  };
}
