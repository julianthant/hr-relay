import { z } from "zod";
import { collapseWhitespace, titleCasePersonName } from "../../models/fields/cell-coercion.js";
import { NamedArtifactFileNameSchema } from "../../models/artifacts/artifacts.js";
import { CrmRosterNamesSchema } from "../../models/workflows/crm-doc-download/documents.js";
import type { CrmDocumentIdentity, CrmDocumentSubject } from "../../models/systems/crm/documents.js";

export function matchesCrmDocumentSubject(subject: CrmDocumentSubject, identity: CrmDocumentIdentity): boolean {
  return subject.kind === "eid" ? identity.eid === subject.value
    : [identity.workEmail, identity.personalEmail].some(email => email !== null && email.toLowerCase() === subject.value.toLowerCase());
}

export function crmDocumentFolderName(input: z.input<typeof CrmRosterNamesSchema>): string {
  const { legalName, livedName } = CrmRosterNamesSchema.parse(input);
  let rawFirst = collapseWhitespace(legalName.firstName), rawMiddle = legalName.middleName;
  const space = rawFirst.indexOf(" ");
  if (rawMiddle === "" && space !== -1) { rawMiddle = rawFirst.slice(space + 1); rawFirst = rawFirst.slice(0, space); }
  const first = titleCasePersonName(rawFirst), last = titleCasePersonName(legalName.lastName);
  const livedFirst = livedName === null ? "" : titleCasePersonName(livedName.firstName.split(/\s+/u)[0] ?? "");
  const lived = livedFirst !== "" && livedFirst.toLowerCase() !== first.toLowerCase() ? ` (${livedFirst})` : "";
  const initial = rawMiddle.replace(/\.+$/u, "").charAt(0).toUpperCase();
  const middle = initial === "" ? "" : ` ${initial}.`;
  return NamedArtifactFileNameSchema.parse(`${last}, ${first}${lived}${middle} EID`);
}

export function crmDocumentIndices(total: number, requested?: readonly number[]): readonly number[] {
  z.number().int().positive().parse(total);
  const indices = requested === undefined
    ? total === 9 || total === 11 ? [0, 2] : total === 1 || total === 2 || total === 5 ? [0] : undefined
    : requested;
  if (indices === undefined) throw new Error("CRM iDocs layout has not been verified");
  const parsed = z.array(z.number().int().nonnegative()).min(1).parse(indices);
  if (new Set(parsed).size !== parsed.length || parsed.some(index => index >= total)) throw new Error("CRM document selection is invalid for this layout");
  return parsed;
}

export function crmDocumentFileName(index: number, header: string | undefined): string {
  z.number().int().nonnegative().parse(index);
  if (index === 0) return "Signed Offer Letter.pdf";
  if (index === 2) return "EE Data Gathering Form.pdf";
  const fallback = `document-${String(index + 1)}.pdf`;
  if (header === undefined) return fallback;
  const encoded = /(?:^|;)\s*filename\*\s*=\s*(?:UTF-8)?'[^']*'([^;]+)/iu.exec(header)?.[1];
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/iu.exec(header);
  let candidate = encoded ?? plain?.[1]?.replace(/\\(.)/gu, "$1") ?? plain?.[2];
  if (candidate === undefined) return fallback;
  try { candidate = decodeURIComponent(candidate.trim()); } catch { return fallback; }
  const base = candidate.replaceAll("\\", "/").split("/").at(-1);
  if (base === undefined || !/\.pdf$/iu.test(base)) return fallback;
  return NamedArtifactFileNameSchema.safeParse(base).success ? base : fallback;
}
