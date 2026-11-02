import { mountRelayOptions } from './relay-options.js';

const initial = await chrome.runtime.sendMessage({ type: 'STATE' });
if (initial?.success && initial.result?.relaySetup === true) {
  await mountRelayOptions(initial.result.profile);
} else {
  document.getElementById('globalStatus').textContent = 'Setup unavailable';
  document.getElementById('globalDetail').textContent = 'Return to Relay to check the original draft.';
}
