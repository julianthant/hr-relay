import { createContext, useRef, type MutableRefObject, type ReactNode } from "react";
import { Dialog, DialogContent } from "../../../ds/ui.js";

/** The review sets this to leave full screen; the dialog spends its first Escape there. */
export const ReviewEscape = createContext<MutableRefObject<(() => void) | undefined> | undefined>(undefined);

/** Review records opens over the dashboard: about 1200 × 800, capped to the window with 24px margins. */
export function ReviewDialog({ open, onOpenChange, subject, children }: { open: boolean; onOpenChange: (open: boolean) => void; subject: string; children: ReactNode }) {
  const exitFullscreen = useRef<() => void>(undefined);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="xl" onEscapeKeyDown={event => { if (exitFullscreen.current) { event.preventDefault(); exitFullscreen.current(); } }} title={<>Review records <span className="ml-1 font-normal text-ui-muted">{subject}</span></>}
      className="h-[min(800px,calc(100vh-48px))] max-h-[calc(100vh-48px)] w-[min(1200px,calc(100vw-48px))] max-w-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-ui-stroke"><ReviewEscape.Provider value={exitFullscreen}>{children}</ReviewEscape.Provider></div>
    </DialogContent>
  </Dialog>;
}
