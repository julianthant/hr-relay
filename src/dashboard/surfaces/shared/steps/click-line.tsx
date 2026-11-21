import { MousePointer2 } from "lucide-react";

export function ClickLine({ label }: { label: string }) {
  return <p className="m-0 flex items-center gap-2 text-body text-ui-secondary"><MousePointer2 aria-hidden className="size-3.5 shrink-0 text-ui-muted" />{label}</p>;
}
