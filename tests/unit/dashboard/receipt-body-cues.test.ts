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
  writeProofAbsence,
  writeProofConfirmation,
  writeProofReadBack,
} from "../../../src/dashboard/surfaces/shared/run-evidence/trust-model.js";

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

/* ── the action write proof's two verdicts (ledger 2 D20/D21) ────────────── */

type Proved = NonNullable<Receipt["actions"][number]["proved"]>;
type Completion = Proved["completion"];
type ProofSource = Proved["proofSource"];

const COMPLETIONS: readonly Completion[] = ["receipt", "save-verify", "upload-verify"];
const PROOF_SOURCES: readonly ProofSource[] = [
  "normal-output", "recovery-probe", "operator-attestation", "durable-intent", "live-probe",
];

describe("writeProofConfirmation (D20)", () => {
  it("a `receipt` completion proved by the commit's own path IS the system's own confirmation record", () => {
    const verdict = writeProofConfirmation("receipt", "ucpath", "normal-output");
    expect(verdict.state).toBe("confirmed");
    expect(verdict.sentence).toContain("system's own receipt");
  });

  it("a probe-sourced proof under a `receipt` completion is still the system's record — a probe reads the target system", () => {
    expect(writeProofConfirmation("receipt", "ucpath", "recovery-probe").state).toBe("confirmed");
    expect(writeProofConfirmation("receipt", "ucpath", "live-probe").state).toBe("confirmed");
  });

  it("a verify-backed completion states the demo's fallback — the system issues no confirmation number, the read-back is the proof", () => {
    for (const completion of ["save-verify", "upload-verify"] as const) {
      const verdict = writeProofConfirmation(completion, "kuali", "normal-output");
      expect(verdict.state).toBe("none-issued");
      expect(verdict.sentence).toContain("no confirmation number");
      expect(verdict.sentence).toContain("read-back");
      expect(verdict.sentence).toContain("KUALI");
    }
  });

  it("an operator-attested proof NEVER wears the system's-own-receipt check — a human's attestation is not the system's record", () => {
    for (const completion of COMPLETIONS) {
      const verdict = writeProofConfirmation(completion, "ucpath", "operator-attestation");
      expect(verdict.state).toBe("attested");
      expect(verdict.state).not.toBe("confirmed");
      expect(verdict.sentence).toContain("attested");
      expect(verdict.sentence).toContain("not the system's");
    }
  });

  it("a durable-intent proof is a prior settled write's record — never a fresh confirmation for this commit", () => {
    for (const completion of COMPLETIONS) {
      const verdict = writeProofConfirmation(completion, "kuali", "durable-intent");
      expect(verdict.state).toBe("prior-record");
      expect(verdict.state).not.toBe("confirmed");
      expect(verdict.sentence).toContain("prior");
    }
  });

  it("is total over every (completion, proofSource) pair, states never share a sentence, and only system-sourced proofs confirm", () => {
    const sentences = new Map<string, string>();
    for (const completion of COMPLETIONS) {
      for (const source of PROOF_SOURCES) {
        const verdict = writeProofConfirmation(completion, "ucpath", source);
        expect(["confirmed", "none-issued", "attested", "prior-record"]).toContain(verdict.state);
        expect(verdict.sentence.length).toBeGreaterThan(0);
        if (verdict.state === "confirmed") {
          expect(["normal-output", "live-probe", "recovery-probe"]).toContain(source);
        }
        const existing = sentences.get(verdict.sentence);
        if (existing !== undefined) expect(existing).toBe(verdict.state);
        sentences.set(verdict.sentence, verdict.state);
      }
    }
    expect(writeProofConfirmation("receipt", "ucpath", "normal-output").sentence)
      .not.toBe(writeProofConfirmation("save-verify", "ucpath", "normal-output").sentence);
  });
});

describe("writeProofReadBack (D21)", () => {
  it("a verify-backed proof from the normal path WAS read back by the independent verify read", () => {
    const verdict = writeProofReadBack("save-verify", "normal-output");
    expect(verdict.state).toBe("read-back");
    expect(verdict.sentence).toContain("read back");
  });

  it("a `receipt` completion's normal path made NO independent check — and says so instead of staying silent", () => {
    const verdict = writeProofReadBack("receipt", "normal-output");
    expect(verdict.state).toBe("not-read-back");
    expect(verdict.sentence).toContain("no independent");
  });

  it("a probe-sourced proof is a read of the target system, whatever the completion declares", () => {
    for (const completion of COMPLETIONS) {
      expect(writeProofReadBack(completion, "live-probe").state).toBe("read-back");
      expect(writeProofReadBack(completion, "recovery-probe").state).toBe("read-back");
    }
  });

  it("an operator attestation and a prior durable proof are both NOT a read-back, each for its own stated reason", () => {
    const attested = writeProofReadBack("upload-verify", "operator-attestation");
    expect(attested.state).toBe("not-read-back");
    expect(attested.sentence).toContain("attested");
    const prior = writeProofReadBack("save-verify", "durable-intent");
    expect(prior.state).toBe("not-read-back");
    expect(prior.sentence).toContain("prior");
    expect(attested.sentence).not.toBe(prior.sentence);
  });

  it("is total over every (completion, proofSource) pair, and every distinct verdict carries a distinct sentence", () => {
    const sentences = new Map<string, string>();
    for (const completion of COMPLETIONS) {
      for (const source of PROOF_SOURCES) {
        const verdict = writeProofReadBack(completion, source);
        expect(["read-back", "not-read-back"]).toContain(verdict.state);
        expect(verdict.sentence.length).toBeGreaterThan(0);
        const existing = sentences.get(verdict.sentence);
        if (existing !== undefined) expect(existing).toBe(verdict.state);
        sentences.set(verdict.sentence, verdict.state);
      }
    }
  });
});

describe("writeProofAbsence — the explicit-absent arm the UI must NAME", () => {
  it("a composition-1 receipt predates the capture; a composition-2 absence means authority holds no proof", () => {
    const preDates = writeProofAbsence(undefined);
    const noProof = writeProofAbsence(2);
    expect(preDates).toContain("before");
    expect(noProof).toContain("no completion proof");
    expect(preDates).not.toBe(noProof);
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
