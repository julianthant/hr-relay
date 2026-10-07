import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LogsPreview } from "./preview.js";
import "../app/index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("The Logs preview requires a root element.");
createRoot(container).render(<StrictMode><LogsPreview /></StrictMode>);
