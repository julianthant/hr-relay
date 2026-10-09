// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { archivedDeleteConfirm } from "../../../../../src/dashboard/surfaces/archive/archive-model.js";

/* ── the two browser APIs jsdom does not implement, stubbed for MEASUREMENT
      only: nothing here asserts a position. ───────────────────────────────── */

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class ZeroDOMRect {
  readonly x = 0;
  readonly y = 0;
  readonly width = 0;
  readonly height = 0;
  readonly top = 0;
  readonly left = 0;
  readonly right = 0;
  readonly bottom = 0;
  static fromRect(): ZeroDOMRect {
    return new ZeroDOMRect();
  }
  toJSON(): Readonly<Record<string, number>> {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "DOMRect", ZeroDOMRect);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The archived record's own digest — what the delete has to cite back. */





/** The same record, having filed one real write — the case the confirm warns about. */

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => { root.unmount(); });
  }
  document.body.replaceChildren();
});

/* ── the copy ────────────────────────────────────────────────────────────── */

describe("the archived delete's confirm copy", () => {
  it("names what leaves, what the released key costs, and that there is no undo", () => {
    const copy = archivedDeleteConfirm({ workflowLabel: "Person Lookup" });

    assert.equal(copy.title, "Delete this archived run");
    assert.equal(copy.confirmLabel, "Delete");
    assert.equal(
      copy.description,
      "It removes the archived record, the retained run, and every row it owns from the database, "
      + "including its write ledger.",
    );
    assert.deepEqual(copy.consequences, [
      "If this run wrote to Person Lookup's systems, the permanent idempotency key that stops "
      + "the same write from being submitted twice is released with it.",
      "This is final; there is no undo.",
    ]);
  });

  it("names the WORKFLOW the run wrote to, not a database noun", () => {
    // Mutation: hard-coding the workflow name in the sentence.
    const copy = archivedDeleteConfirm({ workflowLabel: "Separations" });
    assert.equal(copy.consequences[0]?.includes("Separations's systems"), true, copy.consequences[0]);
  });
});

/* ── the door ────────────────────────────────────────────────────────────── */
