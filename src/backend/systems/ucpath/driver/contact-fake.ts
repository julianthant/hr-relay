import { UcpathContactPageSnapshotSchema } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPageSnapshot } from "../../../../models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPagePort } from "./contact-operation.js";

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
