import { useRef, type ReactNode } from "react";
import { Dialog, DialogBody, DialogContent } from "../../../ds/ui.js";
import { ReviewEscape } from "./review-escape.js";

/** Review records opens over the dashboard: 880 wide (the shared lg width), up to 800 tall, capped to the window. */
export function ReviewDialog({ open, onOpenChange, subject, children }: { open: boolean; onOpenChange: (open: boolean) => void; subject: string; children: ReactNode }) {
  const exitFullscreen = useRef<() => void>(undefined);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="lg" onEscapeKeyDown={event => { if (exitFullscreen.current) { event.preventDefault(); exitFullscreen.current(); } }} title={<>Review records <span className="ml-1 font-normal text-ui-muted">{subject}</span></>}
      className="h-[min(800px,calc(100vh-48px))] max-h-[calc(100vh-48px)]">
      <DialogBody className="flex min-w-0 flex-col overflow-hidden"><ReviewEscape.Provider value={exitFullscreen}>{children}</ReviewEscape.Provider></DialogBody>
    </DialogContent>
  </Dialog>;
}
