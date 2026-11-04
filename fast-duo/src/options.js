import { mountRelayOptions } from './relay-options.js';

document.getElementById('closeSetup').addEventListener('click', async () => {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (!Number.isInteger(tab?.id) || tab.id < 0) throw new Error('RELAY_SETUP_TAB_UNAVAILABLE');
    await chrome.tabs.remove(tab.id);
  } catch {
    const message = document.getElementById('message');
    message.hidden = false; message.setAttribute('role', 'alert');
    message.textContent = 'This tab could not close. Close it with its tab button.';
  }
});

try {
  const initial = await chrome.runtime.sendMessage({ type: 'STATE' });
  if (!initial?.success || initial.result?.relaySetup !== true) throw new Error('RELAY_SETUP_UNAVAILABLE');
  await mountRelayOptions(initial.result.profile);
} catch {
  document.getElementById('globalStatus').textContent = 'Setup unavailable';
  document.getElementById('globalDetail').textContent = 'Open setup again from Relay.';
  document.getElementById('accountCount').textContent = 'Unavailable';
  const list = document.getElementById('accountList');
  list.setAttribute('aria-busy', 'false');
  const description = document.createElement('p');
  description.className = 'empty'; description.textContent = 'Setup details are unavailable.';
  list.replaceChildren(description);
}
