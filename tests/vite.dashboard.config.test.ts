import { describe as describe_m0,expect as expect_m0,it as it_m0,vi } from "vitest";
import dashboardConfig_m0 from "../vite.dashboard.config.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";

import assert_m2 from "node:assert/strict";
import { describe as describe_m2,it as it_m2 } from "vitest";
import {
DASHBOARD_FRONTEND_OWNER_PATH as DASHBOARD_FRONTEND_OWNER_PATH_m1,
DASHBOARD_LAUNCH_NONCE_ENV as DASHBOARD_LAUNCH_NONCE_ENV_m1
} from "../src/models/dashboard/dashboard-frontend-owner.js";

import dashboardConfig_m2 from "../vite.dashboard.config.js";


{


describe_m0("dashboard development proxy origin", () => {
  it_m0("preserves the browser Host for operator-mutation same-origin admission", () => {
    const proxy = dashboardConfig_m0.server?.proxy;

    expect_m0(proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:3938",
      changeOrigin: false,
    });
    expect_m0(proxy?.["/events"]).toMatchObject({
      target: "http://127.0.0.1:3938",
      changeOrigin: false,
    });
  });
});
}

{


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
  assert_m1(plugin !== undefined, "the launch-owner plugin is not registered");
  assert_m1(plugin.configureServer !== undefined, "the launch-owner plugin installs no dev middleware");

  const handlers: MiddlewareHandler[] = [];
  plugin.configureServer({
    middlewares: {
      use: (handler: MiddlewareHandler): void => {
        handlers.push(handler);
      },
    },
  });
  assert_m1.equal(handlers.length, 1);
  return handlers[0];
}

describe_m1("the dashboard dev server's launch-owner middleware", () => {
  it_m1("publishes the launcher's nonce as an uncacheable plain-text body", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV_m1]: NONCE });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "GET", url: DASHBOARD_FRONTEND_OWNER_PATH_m1 }, response, () => {
      nexts += 1;
    });

    assert_m1.equal(nexts, 0);
    assert_m1.equal(response.statusCode, 200);
    assert_m1.deepEqual(response.ended, [NONCE]);
    assert_m1.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");

    assert_m1.equal(response.headers.get("cache-control"), "no-store");
  });

  it_m1("answers 404 with NO body when this process carries no launch nonce", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV_m1]: undefined });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "GET", url: DASHBOARD_FRONTEND_OWNER_PATH_m1 }, response, () => {
      nexts += 1;
    });

    assert_m1.equal(nexts, 0);
    assert_m1.equal(response.statusCode, 404);
    // An empty body, and no headers: a dev server somebody started by hand
    // publishes NOTHING an occupant check could read as ownership.
    assert_m1.deepEqual(response.ended, [""]);
    assert_m1.equal(response.headers.size, 0);
  });

  it_m1("refuses to load at all when the environment carries a malformed nonce", async () => {
    // The nonce is parsed at module load, so a truncated or non-hex value fails
    // the config itself rather than becoming a value this path would publish.
    await assert_m1.rejects(
      loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV_m1]: "not-a-nonce" }),
      { name: "ZodError" },
    );
  });

  it_m1("passes an unrelated path through untouched", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV_m1]: NONCE });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "GET", url: "/index.html" }, response, () => {
      nexts += 1;
    });

    assert_m1.equal(nexts, 1);
    assert_m1.deepEqual(response.ended, []);
    assert_m1.equal(response.statusCode, 0);
    assert_m1.equal(response.headers.size, 0);
  });

  it_m1("passes an unrelated METHOD on the owner path through untouched", async () => {
    const handle = await loadOwnerMiddleware({ [DASHBOARD_LAUNCH_NONCE_ENV_m1]: NONCE });
    const response = recordingResponse();
    let nexts = 0;
    handle({ method: "POST", url: DASHBOARD_FRONTEND_OWNER_PATH_m1 }, response, () => {
      nexts += 1;
    });

    assert_m1.equal(nexts, 1);
    assert_m1.deepEqual(response.ended, []);
    assert_m1.equal(response.statusCode, 0);
  });
});
}

{


describe_m2("the dashboard development proxy", () => {
  it_m2("forwards every browser-reachable BFF surface, including artifact bytes", () => {
    const proxy = dashboardConfig_m2.server?.proxy;
    assert_m2(proxy !== undefined && !Array.isArray(proxy));
    assert_m2.deepEqual(Object.keys(proxy).sort(), ["/api", "/artifacts", "/events"]);

    const expected = { target: "http://127.0.0.1:3938", changeOrigin: false };
    assert_m2.deepEqual(proxy["/api"], expected);
    assert_m2.deepEqual(proxy["/artifacts"], expected);
    assert_m2.deepEqual(proxy["/events"], expected);
  });
});
}
