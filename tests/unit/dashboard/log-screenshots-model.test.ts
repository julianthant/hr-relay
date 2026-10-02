import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { captureGeometry } from "../../../src/dashboard/surfaces/log-screenshots-model.js";

describe("screenshot workspace sizing", () => {
  it("fits a tall complete form and rotates its scrollable canvas without cropping", () => {
    const form = { width: 850, height: 1050 };
    const viewport = { width: 900, height: 600 };
    const whole = captureGeometry(form, viewport, "whole", undefined, 0);
    assert.equal(whole.height, 568);
    assert.ok(whole.width < 868);
    const readable = captureGeometry(form, viewport, "width", undefined, 0);
    assert.equal(readable.width, 868);
    assert.ok(readable.height > 600);
    const turned = captureGeometry(form, viewport, "actual", undefined, 90);
    assert.equal(turned.width, 1050);
    assert.equal(turned.height, 850);
    assert.equal(turned.imageWidth, 850);
    assert.equal(turned.imageHeight, 1050);
    assert.equal(captureGeometry(form, viewport, "whole", 1.25, 0).imageWidth, 1062.5);
  });
  it("refuses corrupt dimensions instead of inventing a plausible size", () => {
    for (const width of [0, -1, NaN, Infinity]) assert.throws(() => captureGeometry({ width, height: 300 }, { width: 900, height: 600 }, "width", undefined, 0), /invalid-dimensions/u);
  });
});
