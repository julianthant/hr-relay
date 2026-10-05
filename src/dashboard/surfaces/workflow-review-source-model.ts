import type { ReviewField, ReviewRecord } from "./workflow-review-model.js";

export type ReviewSourcePage = Readonly<{ page: number; imageUrl: string; label?: string }>;

export function reviewFieldGroups(record: ReviewRecord): readonly { title: string; fields: readonly ReviewField[] }[] {
  const groups = new Map<string, ReviewField[]>();
  for (const field of record.fields) {
    const title = field.section ?? "Employee";
    const fields = groups.get(title) ?? [];
    fields.push(field); groups.set(title, fields);
  }
  return [...groups].map(([title, fields]) => ({ title, fields }));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

// Fixed synthetic source pages; corrections never redraw the document.
export function reviewSourcePages(record: ReviewRecord): readonly ReviewSourcePage[] {
  const pages = record.kind === "i9" ? [Number(record.fields.find(field => field.key === "section1")?.value), Number(record.fields.find(field => field.key === "section2")?.value)] : [record.page];
  return pages.map((page, index) => {
    if (!Number.isInteger(page) || page < 1) throw new Error("MOCK_SOURCE_PAGE_INVALID");
    const title = record.kind === "contact" ? "Emergency Contact Information" : record.kind === "i9" ? `Form I-9 · Section ${index + 1}` : "State Oath of Allegiance";
    let y = 122;
    const content = reviewFieldGroups(record).map(group => {
      const header = `<rect x="32" y="${y}" width="548" height="24" fill="whitesmoke" stroke="gray"/><text x="42" y="${y + 16}" font-size="12" font-weight="bold">${escapeXml(group.title)}</text>`;
      y += 34;
      const fields = group.fields.filter(field => !field.readOnly && (record.kind !== "i9" || (index === 0 ? !["hireDate", "section2"].includes(field.key) : !["dateOfBirth", "section1"].includes(field.key))));
      const rows = fields.map((field, position) => {
        const x = 40 + position % 2 * 276, rowY = y + Math.floor(position / 2) * 38;
        const value = field.kind === "boolean" ? field.value === "true" ? "☑ Yes   ☐ No" : "☐ Yes   ☑ No" : field.value;
        return `<text x="${x}" y="${rowY}" font-size="10">${escapeXml(field.label)}</text><text x="${x + 3}" y="${rowY + 18}" font-family="serif" font-style="italic" font-size="14">${escapeXml(value)}</text><path d="M${x} ${rowY + 23}h252" stroke="silver"/>`;
      }).join("");
      y += Math.ceil(fields.length / 2) * 38 + 12;
      return header + rows;
    }).join("");
    const height = Math.max(792, y + 55);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="612" height="${height}" viewBox="0 0 612 ${height}"><rect width="612" height="${height}" fill="white"/><g fill="black" font-family="Arial, sans-serif"><text x="306" y="44" text-anchor="middle" font-size="12">UNIVERSITY OF CALIFORNIA, SAN DIEGO</text><text x="306" y="76" text-anchor="middle" font-size="21" font-weight="bold">${escapeXml(title)}</text><path d="M32 96h548" stroke="black"/>${content}<text x="580" y="${height - 24}" text-anchor="end" font-size="10">Page ${page}</text></g></svg>`;
    return { page, imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, ...(record.kind === "i9" ? { label: `Section ${index + 1} · Page ${page}` } : {}) };
  });
}
