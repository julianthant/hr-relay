export function completedResponseStream(output: readonly unknown[], model = "gpt-6.1-sol", responseId = "resp_synthetic", usage?: unknown): string {
  const items = output.map((item, index) => typeof item === "object" && item !== null ? { id: `item_synthetic_${String(index)}`, ...item } : item);
  const events: unknown[] = [];
  for (const [output_index, item] of items.entries()) {
    const value = typeof item === "object" && item !== null ? item : {};
    const item_id = "id" in value ? value.id : undefined, type = "type" in value ? value.type : undefined;
    const identity = Object.fromEntries(Object.entries(value).filter(([key]) => ["id", "type", "role", "call_id", "namespace", "name"].includes(key)));
    events.push({ type: "response.output_item.added", output_index, item: { ...identity, id: item_id, type, status: "in_progress" } });
    if (type === "message" && "content" in value && Array.isArray(value.content)) {
      for (const [content_index, part] of (value.content as unknown[]).entries()) {
        if (typeof part !== "object" || part === null || !("type" in part) || part.type !== "output_text" || !("text" in part)) continue;
        events.push({ type: "response.content_part.added", output_index, item_id, content_index, part: { type: "output_text", text: "" } },
          { type: "response.output_text.delta", output_index, item_id, content_index, delta: part.text },
          { type: "response.output_text.done", output_index, item_id, content_index, text: part.text },
          { type: "response.content_part.done", output_index, item_id, content_index, part });
      }
    }
    if (type === "function_call" && "arguments" in value) events.push(
      { type: "response.function_call_arguments.delta", output_index, item_id, delta: value.arguments },
      { type: "response.function_call_arguments.done", output_index, item_id, arguments: value.arguments });
    events.push({ type: "response.output_item.done", output_index, item });
  }
  events.push({ type: "response.completed", response: { id: responseId, model, status: "completed", output: [], ...(usage === undefined ? {} : { usage }) } });
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
}

export function partialTextStream(text: string): string {
  return completedResponseStream([{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }])
    .split('data: {"type":"response.output_text.done"')[0];
}
