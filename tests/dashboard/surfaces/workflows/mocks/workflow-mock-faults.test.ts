import { describe, expect, it } from "vitest";
import {
  approveMockRun, initialMockDraft, mockQueueStatus, mockRunLog, mockRunsForDraft, retryMockFault, type MockDraft,
} from "../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";

const draft = (fault: MockDraft["fault"]): MockDraft => ({ ...initialMockDraft("emergency-contact"), fault, files: [{ name: "contact.pdf", size: 100, digest: "synthetic" }] });

describe("host scenario fixtures", () => {
  it("fails only the page read, offers Retry step on its card and retries only that step", () => {
    const [host, ocr] = mockRunsForDraft("emergency-contact", draft("page"), 1);
    expect(mockQueueStatus(host)).toBe("failed");
    const { timeline, steps } = mockRunLog(host);
    expect(timeline.slice(0, 3).map(stage => stage.state)).toEqual(["failed", "pending", "pending"]);
    const card = steps[0].entries.flatMap(entry => entry.kind === "decision" ? [entry.decision] : [])[0];
    expect(card).toMatchObject({ state: "failed", served: { options: [{ label: "Retry step" }] } });
    const retried = retryMockFault([host, ocr], [host.id, ocr.id]);
    expect(mockQueueStatus(retried[0])).toBe("running");
    expect(mockRunLog(retried[0]).timeline.slice(0, 3).map(stage => stage.state)).toEqual(["completed", "completed", "waiting"]);
  });

  it("fails the first approved member only and clears it on Retry", () => {
    const runs = approveMockRun(mockRunsForDraft("emergency-contact", draft("member"), 1), "mock:emergency-contact:1:0:ocr");
    const members = runs.filter(run => run.role === "person");
    expect(members.map(member => mockQueueStatus(member))).toEqual(["failed", ...members.slice(1).map(() => "done")]);
    expect(mockQueueStatus(retryMockFault(members, [members[0].id])[0])).toBe("done");
  });
});
