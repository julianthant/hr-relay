import { MousePointer2 } from "lucide-react";

export function ClickLine({ label }: { label: string }) {
  return <div>
    <div className="flex items-center gap-3">
      <span className="inline-flex min-w-0 items-center gap-2 rounded-md border border-ui-stroke bg-ui-table px-2.5 py-1.5 text-body font-medium"><MousePointer2 aria-hidden className="size-3.5 shrink-0 text-ui-muted" />{label}</span>
    </div>
  </div>;
}
