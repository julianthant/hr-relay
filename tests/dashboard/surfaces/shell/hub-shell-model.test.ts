import assert from "node:assert/strict";
import { it } from "vitest";
import { chatAge, createMockHubChatsPort } from "../../../../src/dashboard/surfaces/shell/hub-shell-model.js";

it("chat operations retain exact identities and reject unavailable or blank renames", () => {
  const port = createMockHubChatsPort();
  const first = port.read()[0];
  port.rename(first.id, "  Reviewed record  ");
  assert.equal(port.read()[0]?.title, "Reviewed record");
  assert.throws(() => port.rename(first.id, " "), /HUB_CHAT_TITLE_INVALID/);
  assert.throws(() => port.rename("missing", "Title"), /HUB_CHAT_UNAVAILABLE/);
  port.remove(first.id);
  assert.equal(port.read().some(chat => chat.id === first.id), false);
  assert.throws(() => port.remove(first.id), /HUB_CHAT_UNAVAILABLE/);
  const created = port.create();
  assert.equal(created.title, "New chat");
  assert.equal(port.read()[0]?.id, created.id);
  assert.notEqual(port.create().id, created.id);
  for (const chat of port.read()) port.remove(chat.id);
  assert.deepEqual(port.read(), []);
});
it("chat ages use the approved minute wording and day boundaries", () => {
  assert.deepEqual([0, 1, 2, 60, 1440, 4320].map(chatAge), ["Just now", "1 minute ago", "2 minutes ago", "1 hr ago", "1 day ago", "3 days ago"]);
});
