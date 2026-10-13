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
