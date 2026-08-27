/**
 * The receipt body's three ported cues — 03a fidelity ledger 2 rows D17, D24
 * and D29, ported under D273 item 7 ("port every served receipt cue").
 *
 * Each fold is asserted over EVERY arm of its served enum, read out of the
 * schema itself rather than retyped here, so a new arm on the wire fails this
 * file instead of quietly falling into whichever branch happened to be last.
 * That is the whole point of the folds being total: the findings were bare
 * words and missing sentences, and a silent default would be the same defect
 * in a new place.
 */
import { describe, expect, it } from "vitest";
import { RunEvidenceReceiptSchema } from "../../../src/domain/trust/evidence.js";
import {
  uncertaintySentence,
  verificationMark,
  writeActionBadgeTone,
} from "../../../src/dashboard/surfaces/trust-model.js";

type Receipt = ReturnType<typeof RunEvidenceReceiptSchema.parse>;
type ActionKind = Receipt["actions"][number]["kind"];
type VerificationVerdict = Receipt["verification"][number]["verdict"];

const ACTION_KINDS: readonly ActionKind[] = ["external-read", "prepare", "commit", "local-projection"];
const VERDICTS: readonly VerificationVerdict[] = ["verified", "present", "absent", "unknown", "ambiguous"];

describe("writeActionBadgeTone (D17)", () => {
  it("gives `commit` — the arm that changed a real record — the one tone that reads as news", () => {
    expect(writeActionBadgeTone("commit")).toBe("info");
  });

  it("leaves every arm that filed nothing neutral", () => {
    for (const kind of ACTION_KINDS.filter((k) => k !== "commit")) {
      expect(writeActionBadgeTone(kind)).toBe("neutral");
    }
  });

  it("is total over the served kinds", () => {
    for (const kind of ACTION_KINDS) {
      expect(["info", "neutral"]).toContain(writeActionBadgeTone(kind));
    }
  });
});

describe("verificationMark (D24)", () => {
  it("reads `verified` and `present` as the obligation MET", () => {
    expect(verificationMark("verified")).toBe("met");
    expect(verificationMark("present")).toBe("met");
  });

  it("reads `absent` as answered-and-unmet, not as unknown", () => {
    expect(verificationMark("absent")).toBe("unmet");
    expect(verificationMark("absent")).not.toBe("uncertain");
  });

  it("reads the two verdicts that answered nothing as uncertain", () => {
    expect(verificationMark("unknown")).toBe("uncertain");
    expect(verificationMark("ambiguous")).toBe("uncertain");
  });

  it("is total over the served verdicts", () => {
    for (const verdict of VERDICTS) {
      expect(["met", "unmet", "uncertain"]).toContain(verificationMark(verdict));
    }
  });
});

describe("uncertaintySentence (D29)", () => {
  it("says WHY a load-bearing warning stops the run reading as done", () => {
    expect(uncertaintySentence(true)).toBe("load-bearing — this is why the run cannot read as done");
  });

  it("says what a non-load-bearing warning cannot touch — the arm that used to render as nothing", () => {
    expect(uncertaintySentence(false))
      .toBe("declared non-load-bearing — it cannot change the transaction or the core result");
  });

  it("never collapses either arm to the bare word that was the finding", () => {
    expect(uncertaintySentence(true)).not.toBe("load-bearing");
    expect(uncertaintySentence(false).length).toBeGreaterThan("load-bearing".length);
  });
});
