import assert from "node:assert/strict";
import { describe, it } from "vitest";

import dashboardConfig from "../../../../vite.dashboard.config.js";

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
