import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import dashboardConfig from "../vite.dashboard.config.js";
import {
  DASHBOARD_FRONTEND_OWNER_PATH,
  DASHBOARD_LAUNCH_NONCE_ENV,
} from "../src/models/dashboard/dashboard-frontend-owner.js";

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


async function loadOwnerMiddleware(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<MiddlewareHandler> {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) vi.stubEnv(key, undefined);
    else vi.stubEnv(key, value);
  }
  const module: { default: unknown } = await import("../vite.dashboard.config.js");
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
      { name: "ZodError" },
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

describe("the dashboard development proxy", () => {
  it("forwards every browser-reachable BFF surface, including artifact bytes", () => {
    const proxy = dashboardConfig.server?.proxy;
    assert(proxy !== undefined && !Array.isArray(proxy));
    assert.deepEqual(Object.keys(proxy).sort(), ["/api", "/artifacts", "/events"]);

    const expected = { target: "http://127.0.0.1:3938", changeOrigin: false };
    assert.deepEqual(proxy["/api"], expected);
    assert.deepEqual(proxy["/artifacts"], expected);
    assert.deepEqual(proxy["/events"], expected);
  });
});
