/** Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * src/dashboard/components/dev/rebuild-demo/ds/theme.ts */
import { useCallback, useLayoutEffect, useState } from "react";
import { readEnumPreference, writePreference } from "../../lib/preference-storage.js";

// Stamp html, body and the root so portalled overlays inherit the selected theme.

export type DemoTheme = "dark" | "light";

export const DEMO_THEME_ATTR = "data-demo-theme";

const STORAGE_KEY = "rebuild-demo.theme";

export const DEMO_THEME_LABEL: Record<DemoTheme, string> = {
  dark: "Graphite Warm",
  light: "Paper Ink",
};

/** The product ships dark; that is the documented default, not a catch-block guess. */
const THEME_DEFAULT: DemoTheme = "dark";

const THEMES: readonly DemoTheme[] = ["dark", "light"];

function readStoredTheme(): DemoTheme {
  return readEnumPreference(STORAGE_KEY, THEMES, THEME_DEFAULT);
}

/** Owns the demo's theme: the selected value, the DOM stamp, and persistence.
 * Mount it once, at the demo's root. The returned `theme` goes on the root */
export function useDemoTheme(): {
  theme: DemoTheme;
  setTheme: (next: DemoTheme) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<DemoTheme>(readStoredTheme);

  /** A LAYOUT effect, not a plain one */
  useLayoutEffect(() => {
    const html = document.documentElement;
    const { body } = document;
    /** A palette change is a CUT. Without this, the elements carrying
 * `ds-motion` would crossfade their colours over 90–140ms while everything */
    html.setAttribute("data-demo-theme-switching", "");
    const settle = requestAnimationFrame(() => {
      requestAnimationFrame(() => html.removeAttribute("data-demo-theme-switching"));
    });
    html.setAttribute(DEMO_THEME_ATTR, theme);
    body.setAttribute(DEMO_THEME_ATTR, theme);
    return () => {
      cancelAnimationFrame(settle);
      html.removeAttribute("data-demo-theme-switching");
            // The demo is one view inside the real dashboard; leaving the attribute
      // behind would re-theme every other view.
      html.removeAttribute(DEMO_THEME_ATTR);
      body.removeAttribute(DEMO_THEME_ATTR);
    };
  }, [theme]);

  const setTheme = useCallback((next: DemoTheme) => {
    setThemeState(next);
    // Persistence is best-effort and not load-bearing: the selection still
// applies for this session, and nothing downstream reads it back as truth.
    void writePreference(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: DemoTheme = current === "dark" ? "light" : "dark";
      void writePreference(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme };
}
