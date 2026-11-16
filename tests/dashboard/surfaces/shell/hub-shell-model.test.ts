import assert from "node:assert/strict";
import { it } from "vitest";
import { chatAge, createMockHubChatsPort } from "../../../../src/dashboard/surfaces/shell/hub-shell-model.js";

it("chat operations retain exact identities and reject unavailable or blank renames", async () => {
  const port = createMockHubChatsPort();
  const first = port.read()[0];
  await port.rename(first.id, "  Reviewed record  ");
  assert.equal(port.read()[0]?.title, "Reviewed record");
  await assert.rejects(port.rename(first.id, " "), /HUB_CHAT_TITLE_INVALID/);
  await assert.rejects(port.rename("missing", "Title"), /HUB_CHAT_UNAVAILABLE/);
  await port.remove(first.id);
  assert.equal(port.read().some(chat => chat.id === first.id), false);
  await assert.rejects(port.remove(first.id), /HUB_CHAT_UNAVAILABLE/);
  const created = await port.create();
  assert.equal(created.title, "New chat");
  assert.equal(port.read()[0]?.id, created.id);
  assert.notEqual((await port.create()).id, created.id);
  for (const chat of port.read()) await port.remove(chat.id);
  assert.deepEqual(port.read(), []);
});
it("chat ages use the approved minute wording and day boundaries", () => {
  assert.deepEqual([0, 1, 2, 60, 1440, 4320].map(chatAge), ["Just now", "1 minute ago", "2 minutes ago", "1 hr ago", "1 day ago", "3 days ago"]);
});
