/**
 * The phone bundle's entry point (2i-F, D175).
 *
 * A SECOND entry in the same Vite build, not a route inside the operator app.
 * The reason is the scope boundary rather than the layout: doc 12 §7's ingress
 * serves this page's own asset closure and nothing else, and an entry is the
 * only thing a bundler can give an exact closure for. A phone route inside the
 * dashboard bundle would put the queue, the run detail, the command envelope
 * and the SSE client one code-split away from a public origin.
 *
 * The token comes off the fragment HERE, once, and is handed to the client. It
 * is never written back to the URL, the title, storage, or any element.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createCapturePhoneClient, readCaptureTokenFromFragment } from "./capture-client.js";
import { CaptureApp } from "./capture-app.js";
import "./phone.css";

const container = document.getElementById("capture-root");
if (container === null) {
  throw new Error("the capture bundle requires a #capture-root element; capture.html did not provide one");
}

const client = createCapturePhoneClient({
  baseUrl: window.location.origin,
  // Absent is not answered here — see `readCaptureTokenFromFragment`: the empty
  // string reaches the server and comes back as the one fail-closed sentence.
  token: readCaptureTokenFromFragment(window.location.hash),
});

createRoot(container).render(
  <StrictMode>
    <CaptureApp client={client} />
  </StrictMode>,
);
