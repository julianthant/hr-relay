export function SpreadsheetTable({ fields, rows, rowStart, rowNumbers, label, className = "" }: {
  fields: readonly string[];
  rows: readonly Readonly<Record<string, string>>[];
  rowStart: number;
  rowNumbers?: readonly number[];
  label: string;
  className?: string;
}) {
  return <div className={`min-h-0 max-w-full overflow-auto rounded-[7px] border border-ui-stroke bg-ui-panel ${className}`}>
    <table aria-label={label} className="min-w-full border-collapse text-caption leading-[17px]">
      <thead className="text-ui-secondary"><tr>
        <th className="sticky top-0 z-10 border-r border-b border-ui-stroke bg-ui-table px-[13px] py-[11px] text-left text-[10px] font-normal text-ui-muted">Row</th>
        {fields.map(field => <th key={field} className="sticky top-0 z-10 whitespace-nowrap border-r border-b border-ui-stroke bg-ui-table px-[13px] py-[11px] text-left font-semibold last:border-r-0">{field}</th>)}
      </tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} className="[&:last-child>td]:border-b-0">
        <td className="border-r border-b border-ui-stroke bg-ui-table px-[13px] py-[11px] text-[10px] text-ui-muted">{rowNumbers?.[index] ?? rowStart + index}</td>
        {fields.map(field => <td key={field} className={`whitespace-nowrap border-r border-b border-ui-stroke px-[13px] py-[11px] last:border-r-0 ${row[field] ? "" : "text-ui-muted"}`}>{row[field] || "—"}</td>)}
      </tr>)}{!rows.length && <tr><td colSpan={fields.length + 1} className="p-5 text-ui-muted">No matching records.</td></tr>}</tbody>
    </table>
  </div>;
}
