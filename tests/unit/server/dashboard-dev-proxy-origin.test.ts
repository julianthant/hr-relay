import { describe, expect, it } from "vitest";
import dashboardConfig from "../../../vite.dashboard.config.js";

describe("dashboard development proxy origin", () => {
  it("preserves the browser Host for operator-mutation same-origin admission", () => {
    const proxy = dashboardConfig.server?.proxy;

    expect(proxy?.["/api"]).toMatchObject({
      target: "http://127.0.0.1:3938",
      changeOrigin: false,
    });
    expect(proxy?.["/events"]).toMatchObject({
      target: "http://127.0.0.1:3938",
      changeOrigin: false,
    });
  });
});
