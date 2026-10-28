import { randomUUID } from "node:crypto";
import { createNominatimWorkerAdapter } from "../../../../src/backend/processing/providers/nominatim-owner.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

const adapter = createNominatimWorkerAdapter();
const controller = new AbortController();
process.on("message", async message => {
  if (message === "stop") { await adapter.stop(); process.disconnect?.(); return; }
  if (message === "cancel") { controller.abort(); return; }
  if (message !== "call") return;
  const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
  const result = await adapter.invoke(request, { requestId: randomUUID(), signal: controller.signal, deadlineMonotonicMs: systemClock.monotonicMs() + 10_000 });
  if (process.connected) process.send?.({ kind: "result", state: result.response.state });
  if (process.argv[2] === "report-stdout") process.stdout.write(`${JSON.stringify(result)}\n`);
});
process.once("disconnect", () => { void adapter.stop(); });
process.send?.({ kind: "ready" });
