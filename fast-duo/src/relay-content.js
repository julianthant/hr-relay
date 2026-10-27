(() => {
  let registration;
  let accepted = false;
  let priorHeadings = new Map();
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'RELAY_DUO_REQUEST') return;
    const message = event.data;
    if (typeof message.id !== 'string' || !['DUO_AUTOPILOT_SIGN', 'DUO_AUTOPILOT_ENROLL', 'RELAY_NATIVE_CREATED', 'RELAY_CAPABILITIES'].includes(message.operation)) return;
    try {
      if (message.operation === 'DUO_AUTOPILOT_ENROLL') priorHeadings = new Map(
        [...document.querySelectorAll('h1, h2, [role="heading"]')].map(element => [element, element.textContent.trim()]));
      const request = { ...message.request, origin: location.origin, usernames: globalThis.DuoUsername.findUsernames(document) };
      const reply = await chrome.runtime.sendMessage({ type: message.operation, request });
      if (reply?.success && (message.operation === 'RELAY_NATIVE_CREATED' || message.operation === 'DUO_AUTOPILOT_ENROLL' && reply.result.ok)) {
        registration = { requestId: request.requestId, rpId: request.rpId, origin: location.origin, method: message.operation === 'RELAY_NATIVE_CREATED' ? 'touch' : 'key' };
        void checkAcceptance();
      }
      window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: reply?.success === true, result: reply?.result }, location.origin);
    } catch {
      window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: false }, location.origin);
    }
  });
  const checkAcceptance = async () => {
    if (!registration || accepted) return;
    const pattern = registration.method === 'touch' ? /^Added Touch ID$/ : /^Added security key$/;
    const success = [...document.querySelectorAll('h1, h2, [role="heading"]')].filter(element =>
      element.getClientRects().length && pattern.test(element.textContent.trim()) && priorHeadings.get(element) !== element.textContent.trim());
    if (success.length !== 1) return;
    accepted = true;
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'RELAY_PORTAL_ACCEPTED', request: { requestId: registration.requestId, rpId: registration.rpId, origin: registration.origin } });
      if (!reply?.success) throw new Error('ONBOARDING_DUO_PORTAL_UNRECORDED');
    } catch {
      window.postMessage({ type: 'RELAY_DUO_UNCERTAIN' }, location.origin);
    }
  };
  const start = () => {
    new MutationObserver(() => { void checkAcceptance(); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
