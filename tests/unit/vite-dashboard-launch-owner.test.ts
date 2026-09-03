/**
 * The dev server's launch-owner middleware, driven as the middleware — not as a
 * re-implementation of it.
 *
 * `scripts/dev-dashboard.ts` mints a launch nonce and passes it to Vite in the
 * child environment; the preflight's Vite-occupant detector counts an occupant
 * as OWNED only when this path answers with the CURRENT launcher's nonce
 * (ref frontend-backend-integration; the 2026-08-28 preflight lesson). Both
 * halves of that proof live in this handler: the 200 that publishes the nonce,
 * and the 404 that refuses to publish anything when this process was not
 * launched by a launcher. A test that re-implemented the handler could not see
 * either, so every case here takes the function `configureServer` installs.
 *
 * The config reads the environment at MODULE LOAD (a `const` beside the
 * import), which is why each case resets the module registry and imports it
 * again under its own environment rather than mutating anything afterwards.
 */
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

import {
  DASHBOARD_FRONTEND_OWNER_PATH,
  DASHBOARD_LAUNCH_NONCE_ENV,
} from "../../src/domain/dashboard-frontend-owner.js";

const NONCE = "a".repeat(64);

type MiddlewareHandler = (
  request: { method?: string; url?: string },
  response: RecordingResponse,
  next: () => void,
) => void;

interface RecordingResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
  readonly headers: Map<string, string>;
  readonly ended: string[];
}

function recordingResponse(): RecordingResponse {
  const headers = new Map<string, string>();
  const ended: string[] = [];
  return {
    statusCode: 0,
    headers,
    ended,
    setHeader(name: string, value: string): void {
      headers.set(name.toLowerCase(), value);
    },
    end(body?: string): void {
      ended.push(body ?? "");
    },
  };
}

/**
 * Loads the config fresh under `environment` and returns the ONE handler its
 * launch-owner plugin registers with `server.middlewares.use`.
 */
async function loadOwnerMiddleware(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<MiddlewareHandler> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) vi.stubEnv(key, undefined);
    else vi.stubEnv(key, value);
  }
  const module: { default: unknown } = await import("../../vite.dashboard.config.js");
  const config = module.default as {
    plugins?: readonly { name?: string; configureServer?: (server: unknown) => void }[];
  };
  const plugin = config.plugins?.find((candidate) => candidate.name === "hrauto-dashboard-launch-owner");
  assert(plugin !== undefined, "the launch-owner plugin is not registered");
  assert(plugin.configureServer !== undefined, "the launch-owner plugin installs no dev middleware");

  const handlers: MiddlewareHandler[] = [];
  plugin.configureServer({
    middlewares: {
      use: (handler: MiddlewareHandler): void => {
        handlers.push(handler);
      },
    },
  });
  assert.equal(handlers.length, 1);
  return handlers[0];
}

describe("the dashboard dev server's launch-owner middleware", () => {
  it("publishes the launcher's nonce as an uncacheable plain-text body", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV]: NONCE });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "GET", url: DASHBOARD_FRONTEND_OWNER_PATH }, response, () => {
      nexts += 1;
    });

    assert.equal(nexts, 0);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.ended, [NONCE]);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    // The detector compares against the CURRENT launcher's fresh nonce, so a
    // cached answer would let a previous launcher's proof stand in for this
    // one's.
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("answers 404 with NO body when this process carries no launch nonce", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV]: undefined });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "GET", url: DASHBOARD_FRONTEND_OWNER_PATH }, response, () => {
      nexts += 1;
    });

    assert.equal(nexts, 0);
    assert.equal(response.statusCode, 404);
    // An empty body, and no headers: a dev server somebody started by hand
    // publishes NOTHING an occupant check could read as ownership.
    assert.deepEqual(response.ended, [""]);
    assert.equal(response.headers.size, 0);
  });

  it("refuses to load at all when the environment carries a malformed nonce", async () => {
    // The nonce is parsed at module load, so a truncated or non-hex value fails
    // the config itself rather than becoming a value this path would publish.
    await assert.rejects(
      loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV]: "not-a-nonce" }),
    );
  });

  it("passes an unrelated path through untouched", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV]: NONCE });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "GET", url: "/index.html" }, response, () => {
      nexts += 1;
    });

    assert.equal(nexts, 1);
    assert.deepEqual(response.ended, []);
    assert.equal(response.statusCode, 0);
    assert.equal(response.headers.size, 0);
  });

  it("passes an unrelated METHOD on the owner path through untouched", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV]: NONCE });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "POST", url: DASHBOARD_FRONTEND_OWNER_PATH }, response, () => {
      nexts += 1;
    });

    assert.equal(nexts, 1);
    assert.deepEqual(response.ended, []);
    assert.equal(response.statusCode, 0);
  });
});
