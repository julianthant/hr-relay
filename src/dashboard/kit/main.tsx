/** Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * src/dashboard/components/dev/rebuild-demo/kit-entry.tsx */
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
