import { useCallback, useLayoutEffect } from "react";
import { usePersonPreferences, type PersonPreferencesPort } from "../../lib/person-preferences.js";

export type DemoTheme = "dark" | "light";

export const DEMO_THEME_ATTR = "data-demo-theme";

export const DEMO_THEME_LABEL: Record<DemoTheme, string> = {
  dark: "Graphite Warm",
  light: "Paper Ink",
};

export function useDemoTheme(port?: PersonPreferencesPort): {
  theme: DemoTheme;
  setTheme: (next: DemoTheme) => void;
  toggleTheme: () => void;
} {
  const preferences = usePersonPreferences(port);
  const theme = preferences.value.theme;

  useLayoutEffect(() => {
    const html = document.documentElement;
    const { body } = document;
    html.setAttribute("data-demo-theme-switching", "");
    const settle = requestAnimationFrame(() => {
      requestAnimationFrame(() => html.removeAttribute("data-demo-theme-switching"));
    });
    html.setAttribute(DEMO_THEME_ATTR, theme);
    body.setAttribute(DEMO_THEME_ATTR, theme);
    return () => {
      cancelAnimationFrame(settle);
      html.removeAttribute("data-demo-theme-switching");
      html.removeAttribute(DEMO_THEME_ATTR);
      body.removeAttribute(DEMO_THEME_ATTR);
    };
  }, [theme]);

  const change = preferences.change;
  const setTheme = useCallback((next: DemoTheme) => { void change?.({ "preferences.theme": { set: next } }); }, [change]);
  const toggleTheme = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [setTheme, theme]);
  return { theme, setTheme, toggleTheme };
}
