/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/kit-entry.tsx
 *
 * The specimen page's own entry (D274 item 3, ledger 3 UK157).
 *
 * A THIRD entry in the same Vite build, for the same reason the phone is a
 * second one: an entry is the only thing a bundler can state an exact closure
 * for, and this page's closure is `ds/**` plus `lib/**` and nothing else. That
 * is the whole point of a specimen page — what it renders is the design system
 * ITSELF, never a surface, never the client, never a served fact. A route
 * inside the operator app could not make that claim, and `dashboard-wire-boundary`
 * could not check it.
 *
 * It pulls in `app/index.css` so the `--ds-*` layer resolves against the real
 * app theme, exactly as it will inside the dashboard — a specimen rendered
 * against its own private stylesheet would be a specimen of nothing.
 *
 * ONE DELIBERATE DIVERGENCE from the legacy file. Legacy reads
 * `if (root) createRoot(root).render(…)` — a missing container silently paints
 * nothing, which is indistinguishable from a page whose CSS failed. This tree
 * throws, the way `app/main.tsx` and `phone/main.tsx` already do.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KitPage } from "./kit-page.js";
import "../app/index.css";

const container = document.getElementById("ds-kit-root");
if (container === null) {
  throw new Error("the design-system specimen bundle requires a #ds-kit-root element; kit.html did not provide one");
}

createRoot(container).render(
  <StrictMode>
    <KitPage />
  </StrictMode>,
);
