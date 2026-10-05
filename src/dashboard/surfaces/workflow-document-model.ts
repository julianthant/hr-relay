import documents from "../assets/ocr/documents.json" with { type: "json" };
import type { ReviewRecord } from "./workflow-review-model.js";
import type { MockWorkflowId } from "./workflow-mock-catalog.js";
import type { MockDraft } from "./workflow-mock-model.js";
import type { ReviewSourcePage } from "./workflow-review-source-model.js";

export type DocumentFixture = Readonly<{ name: string; parent: MockWorkflowId; formType: string; records: readonly ReviewRecord[]; pages: readonly string[]; sourceSha256: string }>;
// Anonymized document-shaped fixtures; no legacy runtime dependency.
export const OCR_DOCUMENT_FIXTURES = documents as readonly DocumentFixture[];
const pageImages: Readonly<Record<string, readonly string[]>> = {
  "single-oath.pdf": [new URL("../assets/ocr/single-oath-1.webp", import.meta.url).href],
  "multiple-oath.pdf": [new URL("../assets/ocr/multiple-oath-1.webp", import.meta.url).href, new URL("../assets/ocr/multiple-oath-2.webp", import.meta.url).href, new URL("../assets/ocr/multiple-oath-3.webp", import.meta.url).href, new URL("../assets/ocr/multiple-oath-4.webp", import.meta.url).href],
  "emergency-contacts.pdf": [new URL("../assets/ocr/emergency-contacts-1.webp", import.meta.url).href, new URL("../assets/ocr/emergency-contacts-2.webp", import.meta.url).href, new URL("../assets/ocr/emergency-contacts-3.webp", import.meta.url).href],
  "i9.pdf": [new URL("../assets/ocr/i9-1.webp", import.meta.url).href, new URL("../assets/ocr/i9-2.webp", import.meta.url).href, new URL("../assets/ocr/i9-3.webp", import.meta.url).href, new URL("../assets/ocr/i9-4.webp", import.meta.url).href],
  "detect-test.pdf": [new URL("../assets/ocr/detect-test-1.webp", import.meta.url).href, new URL("../assets/ocr/detect-test-2.webp", import.meta.url).href, new URL("../assets/ocr/detect-test-3.webp", import.meta.url).href, new URL("../assets/ocr/detect-test-4.webp", import.meta.url).href, new URL("../assets/ocr/detect-test-5.webp", import.meta.url).href, new URL("../assets/ocr/detect-test-6.webp", import.meta.url).href, new URL("../assets/ocr/detect-test-7.webp", import.meta.url).href],
  "sick-hours.pdf": [new URL("../assets/ocr/sick-hours-1.webp", import.meta.url).href, new URL("../assets/ocr/sick-hours-2.webp", import.meta.url).href, new URL("../assets/ocr/sick-hours-3.webp", import.meta.url).href],
};

export function mockDocumentFixture(draft: Pick<MockDraft, "files">): DocumentFixture | undefined {
  const file = draft.files[0];
  if (!file?.digest.startsWith("fixture:document:")) return undefined;
  const fixture = OCR_DOCUMENT_FIXTURES.find(item => item.name === file.name);
  if (!fixture) throw new Error("MOCK_DOCUMENT_FIXTURE_MISSING");
  return fixture;
}

export function documentSourcePages(draft: Pick<MockDraft, "files">, record: ReviewRecord): readonly ReviewSourcePage[] | undefined {
  const fixture = mockDocumentFixture(draft);
  if (!fixture) return undefined;
  const pages = record.kind === "i9" ? [record.page, Number(record.fields.find(field => field.key === "section2")?.value)] : record.kind === "separation" ? [1, 2, 3] : [record.page];
  return pages.map(page => {
    const imageUrl = pageImages[fixture.name]?.[page - 1];
    if (!imageUrl) throw new Error("MOCK_DOCUMENT_PAGE_MISSING");
    return { page, imageUrl };
  });
}
