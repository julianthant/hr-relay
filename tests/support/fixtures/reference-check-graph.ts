export function expectedReferenceNodes(suffix: string, sources: readonly string[], earlier: readonly string[]) {
  const check = `reference-fields-${suffix}`;
  const gate = `reference-field-review-${suffix}`;
  const label = "Review reference spreadsheet differences";
  const taskId = "workbooks/read-reference-fields";
  const graph = [
    { id: check, kind: "task", dependsOn: [...sources, ...earlier],
      when: { kind: "is-present", of: { from: "reference", typeId: "reference-check" } } },
    { id: gate, kind: "gate", dependsOn: [check],
      when: { kind: "is-present", of: { from: "node", nodeId: check, path: "review" } } },
  ];
  return {
    ids: [check, gate],
    graph,
    gate: { nodeId: gate, label, resolvedBy: "operator" },
    timelineNodes: [{ id: check, label: "Compare reference fields" }, { id: gate, label }],
    steps: [
      { key: check, nodeId: check, label: "Compare reference fields", kind: "task", taskId, conditional: true },
      { key: gate, nodeId: gate, label, kind: "gate", conditional: true },
    ],
    entries: graph.map(({ id, kind, dependsOn }) => ({ id, kind, nodeIds: [id], dependsOn, taskIds: kind === "task" ? [taskId] : [] })),
  };
}

export function expectedReferenceStages(suffixes: readonly string[]) {
  const stages: ReturnType<typeof expectedReferenceNodes>[] = [];
  for (const [index, suffix] of suffixes.entries()) {
    stages.push(expectedReferenceNodes(suffix, suffixes.slice(1, index + 1), stages.flatMap(stage => stage.ids)));
  }
  return stages;
}
