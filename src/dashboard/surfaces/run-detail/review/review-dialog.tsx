import type { ReactNode } from "react";
import { Dialog, DialogContent } from "../../../ds/ui.js";

/** Review records opens over the dashboard: about 1200 × 800, capped to the window with 24px margins. */
export function ReviewDialog({ open, onOpenChange, subject, children }: { open: boolean; onOpenChange: (open: boolean) => void; subject: string; children: ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="xl" title={<>Review records <span className="ml-1 font-normal text-ui-muted">{subject}</span></>}
      className="h-[min(800px,calc(100vh-48px))] max-h-[calc(100vh-48px)] w-[min(1200px,calc(100vw-48px))] max-w-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-ui-stroke">{children}</div>
    </DialogContent>
  </Dialog>;
}
