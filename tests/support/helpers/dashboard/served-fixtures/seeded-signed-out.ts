import { once } from "node:events";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { ProfileLoginRequestSchema, PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { FIXTURE_ACTIVE_PROFILE_STATE } from "../profiles/fixture-profile-setup.js";

export const FIXTURE_LOGIN = { email: "relay-smoke@ucsd.edu", password: "synthetic-password" };

/** Serves a synthetic profile session over the same origin as the seeded app and event stream. */
export async function startSignedOut(seededOrigin: string, ready: Promise<void>) {
  let current = PublicProfileStateSchema.parse({ state: "signed-out" });
  const refused = PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
  const serve = async (incoming: IncomingMessage, reply: ServerResponse) => {
    if (incoming.method === "GET" && incoming.url === "/api/v1/profile/state") {
      reply.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(current));
      return;
    }
    if (incoming.method === "POST" && incoming.url === "/api/v1/profile/sign-in") {
      incoming.setEncoding("utf8");
      let body = "";
      for await (const chunk of incoming) {
        if (typeof chunk !== "string") throw new Error("Expected UTF-8 profile input");
        body += chunk;
      }
      const login = ProfileLoginRequestSchema.parse(JSON.parse(body));
      if (login.email !== FIXTURE_LOGIN.email || login.password !== FIXTURE_LOGIN.password) {
        reply.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(refused));
        return;
      }
      await ready;
      current = FIXTURE_ACTIVE_PROFILE_STATE;
      reply.writeHead(200, { "content-type": "application/json", "x-relay-session": "fixture-session", "x-relay-resume": "fixture-resume" }).end(JSON.stringify(current));
      return;
    }
    const url = new URL(incoming.url ?? "/", seededOrigin);
    if (url.origin !== seededOrigin) throw new Error("Signed-out fixture only serves the seeded origin");
    const upstream = request(url, { method: incoming.method, headers: incoming.headers }, response => {
      reply.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(reply);
    });
    upstream.on("error", error => reply.destroy(error));
    reply.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  };
  const server = createServer((incoming, reply) => {
    void serve(incoming, reply).catch((error: unknown) => { reply.destroy(error instanceof Error ? error : new Error(String(error))); });
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Signed-out fixture has no TCP address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error));
      server.closeAllConnections();
    }),
  };
}
