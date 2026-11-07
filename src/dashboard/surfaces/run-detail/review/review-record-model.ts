import type { OcrFormType } from "../../../../models/ocr/form-registry.js";

export type ReviewField = Readonly<{ key: string; label: string; value: string; kind?: "date" | "boolean" | "relationship"; section?: string; readOnly?: boolean }>;
export type ReviewRecordView = Readonly<{
  id: string; page: number; kind: OcrFormType | "contact" | "verify" | "separation";
  fields: readonly ReviewField[]; selected: boolean; unknown?: boolean;
  warnings: readonly string[];
  i9Section?: 1 | 2; manualEntry?: boolean; sourcePageCount?: number;
}>;
export const REVIEW_RELATIONSHIPS = ["Parent", "Sibling", "Spouse", "Domestic Partner Adult", "Domestic Partner Child", "Child", "Grandchild", "Grand Parent", "Other Relative", "Friend", "Neighbor", "Roommate", "Ward", "Medical Provider", "Emerg/Detention/Arrest Contact", "Contact if Detained/Arrested", "Other"];

export type ReviewSourcePage = Readonly<{ page: number; imageUrl: string; identity?: string; label?: string }>;

export interface RecordReviewProps {
  readonly runId: string;
  readonly subject: string;
  readonly cards: readonly { record: ReviewRecordView; name: string; original?: ReviewRecordView; pages: readonly ReviewSourcePage[];
    disposition?: Readonly<{ label: string; tone: "success" | "neutral" }>; approvalError?: string }[];
  readonly readOnly: boolean;
  readonly discarded: boolean;
  readonly selectedCount: number;
  readonly disabled?: boolean;
  readonly actionsDisabled?: boolean;
  readonly approvalError?: string;
  readonly focusId?: string;
  readonly onEditField?: (recordId: string, key: string, value: string) => void;
  readonly onCommit?: () => void;
  readonly onChange?: (record: ReviewRecordView) => void;
  readonly onAdd?: () => string;
  readonly onApprove?: () => void;
  readonly onDiscard?: () => void;
  readonly onRestore?: () => void;
}

export function reviewFieldGroups(record: ReviewRecordView): readonly { title: string; fields: readonly ReviewField[] }[] {
  const groups: { title: string; fields: ReviewField[] }[] = [];
  for (const field of record.fields) {
    const title = field.section ?? "Employee";
    const previous = groups[groups.length - 1];
    if (previous?.title === title) previous.fields.push(field);
    else groups.push({ title, fields: [field] });
  }
  return groups;
}

export function reviewFieldBlocks(fields: readonly ReviewField[]): readonly (readonly ReviewField[])[] {
  const blocks: ReviewField[][] = [];
  for (const field of fields) {
    const previous = blocks[blocks.length - 1];
    if (field.kind === "boolean" && previous?.[0].kind === "boolean") previous.push(field);
    else blocks.push([field]);
  }
  return blocks;
}

export function reviewFieldPresentation(field: ReviewField): { wide: boolean; multiline: boolean } {
  const multiline = /\b(?:notes|comments|instructions|additional information)\b/iu.test(field.label);
  return { wide: multiline || /\b(?:street|email|title|citizenship)\b/iu.test(field.label), multiline };
}
