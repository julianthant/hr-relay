// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { cn } from "../../../src/dashboard/lib/utils.js";

describe("approved Explorer presentation", () => {
  it("keeps shared semantic font roles mutually exclusive", () => {
    assert.equal(cn("text-page text-ui-info", "text-workflow"), "text-ui-info text-workflow");
    assert.equal(cn("text-workflow", "text-caption"), "text-caption");
  });
});

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let mounted: Root | undefined;
afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount());
  mounted = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
