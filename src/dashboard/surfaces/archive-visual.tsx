import { Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ArchiveReportCellSchema, type ArchiveReportCell } from "../../domain/archive/report.js";
import { Button, dsIcon, dsText, Table } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { savedCell } from "./archive-report-model.js";

export function ArchiveTable({ label, children, className, roomy = false }: { label: string; children: ReactNode; className?: string; roomy?: boolean }) {
  return <Table label={label} className={cn(
    "min-w-max [&_thead_tr]:!h-[40px] [&_thead_th]:!h-[40px] [&_thead_th]:!px-[var(--ds-space-cozy)] [&_thead_th]:!py-[var(--ds-space-snug)] [&_thead_th]:!text-[12px] [&_thead_th]:!font-semibold [&_thead_th]:!normal-case [&_thead_th]:!tracking-normal",
    "[&_tbody_tr]:h-[46px] [&_tbody_td]:!px-[var(--ds-space-cozy)] [&_tbody_td]:!py-[var(--ds-space-snug)] [&_tbody_td]:!text-[12px] [&_tbody_tr:hover]:bg-[var(--ds-surface-2)]",
    roomy && "[&_thead_tr]:!h-[44px] [&_thead_th]:!h-[44px] [&_thead_th]:!px-[16px] [&_tbody_tr]:!min-h-[52px] [&_tbody_td]:!px-[16px] [&_tbody_td]:!py-[16px]",
    className,
  )}>{children}</Table>;
}

export function ArchiveFieldGroup({ title, ariaLabel, children, className, showHeading = true }: { title: string; ariaLabel?: string; children: ReactNode; className?: string; showHeading?: boolean }) {
  return <section aria-label={ariaLabel ?? title} className={cn("min-w-0 overflow-hidden rounded-[var(--ds-radius-md)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-1)]", className)}>
    {showHeading && <h3 className={cn(dsText.ui, "m-0 border-b border-[color:var(--ds-border)] px-[20px] py-[17px] !text-[12px] !leading-[17.4px] font-semibold")}>{title}</h3>}
    {children}
  </section>;
}

export function ArchiveFieldRows({ rows, columns = "two" }: { rows: readonly { label: string; value: ReactNode; copyValue?: string }[]; columns?: "one" | "two" }) {
  return <dl className={cn("grid min-w-0 grid-cols-1", columns === "two" && "min-[1200px]:grid-cols-2")}>
    {rows.map((row, index) => <div key={`${row.label}:${index}`} className={cn(
      "grid min-h-[46px] min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-[var(--ds-space-base)] gap-y-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] px-[20px] py-[14px] text-[12px] leading-[17.4px] last:border-b-0",
      columns === "two" && "min-[1200px]:[&:nth-child(odd)]:border-r",
      columns === "two" && index >= rows.length - (rows.length % 2 === 0 ? 2 : 1) && "min-[1200px]:border-b-0",
    )}><dt className="min-w-0 break-words text-[color:var(--ds-fg-muted)] [overflow-wrap:anywhere]">{row.label}</dt><dd className="m-0 min-w-0 break-words text-right font-medium [overflow-wrap:anywhere]">{row.copyValue === undefined ? row.value : <ArchiveCopyable label={row.label} value={row.copyValue}>{row.value}</ArchiveCopyable>}</dd></div>)}
  </dl>;
}

export function ArchiveStructuredValue({ value }: { value: ArchiveReportCell }) {
  if (value === null || typeof value !== "object" || Object.keys(value).length === 0) return <>{savedCell(value)}</>;
  const entries = Object.entries(value).map(([key, item]) => [key, ArchiveReportCellSchema.parse(item)] as const);
  const exact = JSON.stringify(value);
  return <details className="inline-block max-w-full text-left align-middle">
    <summary className="cursor-pointer text-[color:var(--ds-fg)]">{Array.isArray(value) ? `List · ${entries.length} items` : `Record · ${entries.length} fields`}</summary>
    <div className="mt-[var(--ds-space-snug)] max-h-[240px] max-w-[560px] overflow-auto rounded-[var(--ds-radius-sm)] border border-[color:var(--ds-border)] bg-[var(--ds-surface-2)] p-[var(--ds-space-cozy)]">
      <dl className="m-0 grid grid-cols-[minmax(80px,auto)_minmax(0,1fr)] gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-snug)]">{entries.map(([key, item]) => <div key={key} className="contents"><dt className="break-all text-[color:var(--ds-fg-muted)]">{key}</dt><dd className="m-0 break-words [overflow-wrap:anywhere]">{savedCell(item)}</dd></div>)}</dl>
      <details className="mt-[var(--ds-space-base)]"><summary className="cursor-pointer">Exact JSON</summary><pre className="m-0 max-h-[160px] overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{exact}</pre></details>
    </div>
  </details>;
}

function ArchiveCopyable({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const [status, setStatus] = useState("");
  return <span className="inline-flex max-w-full items-center gap-[var(--ds-space-tight)]"><span className="min-w-0 select-text break-all" title={value}>{children}</span><Button size="sm" variant="ghost" icon={<Copy className={dsIcon.sm} aria-hidden />} aria-label={`Copy ${label}`} onClick={() => {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error("Clipboard unavailable");
      void navigator.clipboard.writeText(value).then(() => setStatus(`${label} copied.`), () => setStatus(`${label} could not be copied.`));
    } catch { setStatus(`${label} could not be copied.`); }
  }} /><span className="sr-only" role="status">{status}</span></span>;
}
