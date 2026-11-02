import { describe, expect, it } from "vitest";
import { I9CheckInput } from "../../../src/models/workflows/i9-check/input.js";
import { i9MatchOutcome, i9RetentionRow } from "../../../src/rules/i9-check/retention.js";
import { i9CheckInput, i9Candidate, i9Search } from "../../support/fixtures/i9-check.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";

const absent = { status: "not-found", candidateCount: 0 } as const;
const found = i9MatchOutcome({ hits: [i9Candidate], confirmed: [i9Candidate], dropped: [] });
const row = (input = i9CheckInput) => i9RetentionRow({ input, initial: found });

describe("I-9 identity and retention", () => {
  it("accepts one distinct confirmed EID and keeps ambiguity explicit", () => {
    expect(i9MatchOutcome()).toEqual(absent);
    expect(i9MatchOutcome({ hits: [], confirmed: [i9Candidate, i9Candidate], dropped: [] })).toEqual(found);
    expect(i9MatchOutcome({ hits: [], confirmed: [i9Candidate, { ...i9Candidate, emplId: EidSchema.parse("10000002") }], dropped: [] })).toMatchObject({ status: "ambiguous", candidateCount: 2 });
  });
  it.each([[-8, "not-found"], [-7, "found"], [0, "found"], [7, "found"], [8, "not-found"]])("corroborates hire date offset %i", (offset, status) => {
    const startDate = new Date(Date.parse("2020-06-15") + Number(offset) * 86400000).toISOString().slice(0, 10);
    expect(i9RetentionRow({ input: i9CheckInput, initial: absent, search: i9Search([{ ...i9Candidate, startDate }]) }).identity.status).toBe(status);
  });
  it("does not accept a name-only hit without hire date or choose multiple dated people", () => {
    const input = I9CheckInput.parse({ ...i9CheckInput, person: { name: "Example, Person", sourcePages: [3] } });
    expect(i9RetentionRow({ input, initial: absent, search: i9Search() })).toMatchObject({ identity: { status: "ambiguous", reason: "missing-hire-date" }, row: { action: "", ucpathEmplId: "" } });
    expect(i9RetentionRow({ input: i9CheckInput, initial: absent, search: i9Search([i9Candidate, { ...i9Candidate, emplId: "10000002" }]) }).identity.status).toBe("ambiguous");
  });
  it("never turns confirmed identifier ambiguity into Shred or accepts an unrelated name hit", () => {
    const initial = i9MatchOutcome({ hits: [], confirmed: [i9Candidate, { ...i9Candidate, emplId: EidSchema.parse("10000002") }], dropped: [] });
    for (const search of [i9Search([]), i9Search([{ ...i9Candidate, startDate: "01/01/2000" }]), i9Search([{ ...i9Candidate, emplId: "10000003" }])]) {
      expect(i9RetentionRow({ input: i9CheckInput, initial, search })).toMatchObject({ identity: { status: "ambiguous" }, row: { action: "", ucpathEmplId: "" } });
    }
    expect(i9RetentionRow({ input: i9CheckInput, initial, search: i9Search() }).identity).toMatchObject({ status: "found", eid: "10000001" });
  });
  it("counts every appointment before deduplication and allows the verified blank Last Hire case", () => {
    const candidates = [{ ...i9Candidate, startDate: "01/01/2000" }, i9Candidate];
    expect(i9RetentionRow({ input: i9CheckInput, initial: absent, search: i9Search(candidates) }).identity.status).toBe("found");
    expect(i9RetentionRow({ input: i9CheckInput, initial: absent, search: i9Search([{ ...i9Candidate, startDate: "" }]) }).identity.status).toBe("found");
    expect(() => i9RetentionRow({ input: i9CheckInput, initial: absent })).toThrow(/observation is missing/u);
    expect(() => i9RetentionRow({ input: i9CheckInput, initial: absent, search: i9Search([{ ...i9Candidate, startDate: "02/30/2020" }]) })).toThrow(/date is invalid/u);
  });
  it("rematches EID first, preserves padded PPS IDs and chooses the latest termination", () => {
    const input = I9CheckInput.parse({ ...i9CheckInput, roster: { seed: { ppsEid: "99999", separationDate: "2025-01-01" }, rows: [
      ...i9CheckInput.roster.rows, { ...i9CheckInput.roster.rows[0], separationDate: "2026-01-01", action: "HIRE" },
      { ...i9CheckInput.roster.rows[0], separationDate: "2022-01-01", action: "Termination" },
    ] } });
    expect(row(input).row).toMatchObject({ ppsEid: "000012345", separationDate: "2022-01-01", action: "Keep" });
  });
  it("uses the PPS rematch on an EID miss and retains a seed only when no rematch exists", () => {
    const input = I9CheckInput.parse({ ...i9CheckInput, roster: { rows: [{ ...i9CheckInput.roster.rows[0], eid: "10000002" }], seed: { ppsEid: "12345" } } });
    expect(row(input).row.ppsEid).toBe("000012345");
    const seed = I9CheckInput.parse({ ...i9CheckInput, roster: { rows: [], seed: { ppsEid: "00098765", separationDate: "2025-01-01" } } });
    expect(row(seed).row).toMatchObject({ ppsEid: "00098765", separationDate: "2025-01-01", action: "Keep" });
    expect(row(I9CheckInput.parse({ ...i9CheckInput, roster: { rows: [] } })).row).toMatchObject({ action: "", notes: "No roster separation date; review manually." });
  });
  it("refuses a PPS seed identifying more than one roster employee", () => {
    const input = I9CheckInput.parse({ ...i9CheckInput, roster: { seed: { ppsEid: "12345" }, rows: ["10000002", "10000003"].map(eid => ({ ...i9CheckInput.roster.rows[0], eid })) } });
    expect(() => row(input)).toThrow(/multiple employees/u);
  });
  it.each([["2026-10-31", "Keep"], ["2026-11-01", "Keep"], ["2026-11-02", "Shred"]])("applies the five-year boundary on %s", (asOf, action) => {
    const result = row(I9CheckInput.parse({ ...i9CheckInput, asOf })).row;
    expect(result.action).toBe(action);
    if (action === "Keep") expect(result.notes).toBe("Shred on 2026-11-02");
  });
  it("handles leap-day retention and never places sensitive identifiers in a result row", () => {
    const input = I9CheckInput.parse({ ...i9CheckInput, person: { ...i9CheckInput.person, ssn: "123456789", dob: "2000-01-15" },
      asOf: "2025-03-01", roster: { rows: [{ ...i9CheckInput.roster.rows[0], separationDate: "2020-02-29" }] } });
    const output = row(input);
    expect(output.row.notes).toBe("Shred on 2025-03-02");
    expect(JSON.stringify(output)).not.toContain("123456789");
    expect(JSON.stringify(output)).not.toContain("2000-01-15");
  });
  it("keeps not-found distinct from unavailable and rejects malformed roster/date input", () => {
    expect(i9RetentionRow({ input: i9CheckInput, initial: absent, search: i9Search([]) }).row.action).toBe("Shred");
    expect(I9CheckInput.safeParse({ ...i9CheckInput, roster: undefined }).success).toBe(false);
    expect(I9CheckInput.safeParse({ ...i9CheckInput, asOf: "2026-02-30" }).success).toBe(false);
    expect(I9CheckInput.safeParse({ ...i9CheckInput, roster: { rows: [{ eid: "bad" }] } }).success).toBe(false);
  });
});
