export function workflowReferenceId(workflowId: string): string {
  if (workflowId === "fixture-i9-check-start") return "fixture-i9-check";
  return workflowId === "i9-check-start" ? "i9-check" : workflowId;
}
