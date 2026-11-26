import type { ReactNode } from "react";
import { ArrowDownToLine, Check, Copy, ListChecks, MoreHorizontal, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton } from "../../../ds/ui.js";
import type { LogTools } from "./log-feed.js";
import "./log-presentation.css";

export type LogMenuRerun = Readonly<{ label: string; run: () => void }>;
export type LogMenuRecords = Readonly<{ count: number; open: () => void }>;

/** The ⋯ menu at the right of the run header: Rerun, Copy logs, Download logs, then Records. */
export function LogActionsMenu({ title, tools, rerun, records }: { title: string; tools?: LogTools; rerun?: LogMenuRerun; records?: LogMenuRecords }): ReactNode {
  if (rerun === undefined && tools === undefined && records === undefined) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><IconButton size="md" label="More actions" icon={<MoreHorizontal aria-hidden className="size-4" />} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="log-actions-menu">
      {rerun && <DropdownMenuItem onSelect={rerun.run}><RotateCcw aria-hidden className="size-4" />{rerun.label}</DropdownMenuItem>}
      {tools && <>
        <DropdownMenuItem disabled={!tools.canCopy} onSelect={tools.copy}>{tools.copyState === "copied" ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}Copy logs</DropdownMenuItem>
        <DropdownMenuItem disabled={!tools.canCopy} onSelect={() => tools.download(title)}><ArrowDownToLine aria-hidden className="size-4" />Download logs</DropdownMenuItem>
      </>}
      {records && <DropdownMenuItem onSelect={records.open}><ListChecks aria-hidden className="size-4" />Records ({records.count})</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
