


import { createServer } from "node:http";





import { probeOwnedViteServer } from "../../../../src/backend/app/host/local-vite-probe.js";


import { DASHBOARD_FRONTEND_OWNER_PATH } from "../../../../src/backend/transports/http/frontend-owner.js";






import type { Clock } from "../../../../src/rules/time/clock.js";
export function createOwnedViteProbeFixtures(CLOCK: Clock, OWNER_NONCE: string) {
async function probeViteIdentity(fixture: Readonly<{
  owner: string;
  index: string;
  client: string;
}>) {
  const requestedPaths: string[] = [];
  const server = createServer((request, response) => {
    requestedPaths.push(request.url ?? "<missing>");
    response.writeHead(200, { "content-type": "text/plain" });
    response.end(request.url === DASHBOARD_FRONTEND_OWNER_PATH
      ? fixture.owner
      : request.url === "/"
        ? fixture.index
        : fixture.client);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("test server exposed no TCP address");
    const result = await probeOwnedViteServer({
      port: address.port,
      signal: new AbortController().signal,
      deadlineMonotonicMs: CLOCK.monotonicMs() + 1_000,
      clock: CLOCK,
      ownerNonce: OWNER_NONCE,
    });
    return { result, requestedPaths };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}
return { probeViteIdentity };
}
