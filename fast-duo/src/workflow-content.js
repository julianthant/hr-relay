(() => {
  let documentActive = true;
  let revision = 0;
  let previous;
  const active = new Set();
  const observation = () => {
    const accountNames = globalThis.DuoUsername.findUsernames(document);
    const signature = JSON.stringify(accountNames);
    if (previous !== undefined && previous !== signature) revision++;
    previous = signature;
    return { url: location.href, origin: location.origin, documentActive, accountRevision: revision, accountNames };
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b) && a.documentActive && b.documentActive;
  const abort = id => { active.delete(id); return chrome.runtime.sendMessage({ type: 'DUO_WORKFLOW_ABORT', requestId: id }); };
  window.addEventListener('pagehide', () => { documentActive = false; for (const id of active) void abort(id); });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'RELAY_OBSERVE') return false;
    reply(observation()); return false;
  });
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || typeof event.data?.id !== 'string') return;
    const message = event.data;
    if (message.type === 'DUO_WORKFLOW_ABORT') { await abort(message.id); return; }
    if (message.type !== 'DUO_WORKFLOW_REQUEST' || active.has(message.id)) return;
    active.add(message.id);
    const before = observation();
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'DUO_AUTOPILOT_SIGN', request: { ...message.request, origin: location.origin } });
      if (!active.has(message.id) || !reply?.success || !same(before, observation())) throw new Error('DUO_REQUEST_REVOKED');
      window.postMessage({ type: 'DUO_WORKFLOW_RESPONSE', id: message.id, success: true, result: reply.result }, location.origin);
    } catch {
      window.postMessage({ type: 'DUO_WORKFLOW_RESPONSE', id: message.id, success: false }, location.origin);
    } finally { active.delete(message.id); }
  });
  let trustClickAllowed = true;
  let checking = false;
  let clicked = false;
  async function checkTrust() {
    if (!trustClickAllowed || checking || clicked) return;
    const button = [...document.querySelectorAll('button, input[type="submit"]')].find(el =>
      el.getClientRects().length && !el.disabled && /^yes,\s*(this is my device|trust (?:this )?browser)$/i.test((el.innerText || el.value || '').trim()));
    if (!button) return;
    checking = true;
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'DUO_SETTINGS' });
      if (reply?.success && reply.result.enabled && reply.result.trustClick && button.isConnected) {
        clicked = true;
        button.click();
      }
    } catch { /* Extension unavailable: leave the trust choice to the user. */ }
    finally { checking = false; }
  }
  const start = () => {
    const observer = new MutationObserver(() => { observation(); void checkTrust(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    void checkTrust();
    setTimeout(() => { trustClickAllowed = false; }, 60000);
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
