import assert from "node:assert/strict";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";

export function profileActivationResponse(body: unknown): Response {
  const headers = new Headers();
  if (typeof body === "object" && body !== null && "state" in body) {
    if (body.state === "active") {
      headers.set("x-relay-session", "active." + crypto.randomUUID());
      headers.set("x-relay-resume", crypto.randomUUID());
    } else if (body.state === "onboarding") headers.set("x-relay-session", "draft." + crypto.randomUUID());
  }
  return Response.json(body, { headers });
}

export function sharedProfileCookieTabs(base: string) {
  let credential: string | null = null;
  const tab = () => {
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(`${base}/api/v1/profile/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { origin: base, ...(credential === null ? {} : { "x-relay-session": credential }),
          ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.headers.has("set-cookie"), false);
      const next = response.headers.get("x-relay-session");
      if (next !== null) {
        const { state } = PublicProfileStateSchema.parse(await response.clone().json());
        assert.ok(state === "active" || state === "onboarding");
        assert.match(next, state === "active" ? /^active\.[a-f0-9]{64}$/u : /^draft\.[a-f0-9]{64}$/u);
        credential = next;
      } else if ((path === "logout" || path === "delete-account") && response.ok) {
        const body: unknown = await response.clone().json();
        if (typeof body === "object" && body !== null && "state" in body && body.state === "signed-out") credential = null;
      }
      return response;
    };
    return { read: () => request("state"), post: (path: string, body: unknown) => request(path, body) };
  };
  return { tabA: tab(), tabB: tab() };
}
