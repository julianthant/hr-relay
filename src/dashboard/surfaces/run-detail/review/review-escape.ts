import { createContext, type MutableRefObject } from "react";

/** The review sets this to leave full screen; the dialog spends its first Escape there. */
export const ReviewEscape = createContext<MutableRefObject<(() => void) | undefined> | undefined>(undefined);
