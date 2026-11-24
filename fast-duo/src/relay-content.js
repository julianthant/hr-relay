(() => {
  const controllers = new Map();
  let registration;
  let priorHeadings = new Map();
  let documentActive = true;
  let accountRevision = 0;
  let lastAccount;
  const observation = () => {
    const accountNames = globalThis.DuoUsername.findUsernames(document);
    const signature = JSON.stringify(accountNames);
    if (lastAccount !== undefined && lastAccount !== signature) accountRevision++;
    lastAccount = signature;
    return { url: location.href, origin: location.origin, documentActive, accountRevision, accountNames };
  };
  window.addEventListener('pagehide', () => {
    documentActive = false;
    for (const entry of controllers.values()) entry.controller.abort();
  });
  const sameObservation = (before, after) => before.documentActive && after.documentActive
    && before.url === after.url && before.origin === after.origin && before.accountRevision === after.accountRevision
    && JSON.stringify(before.accountNames) === JSON.stringify(after.accountNames);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type !== 'RELAY_OBSERVE') return false;
    sendResponse(observation());
    return false;
  });
  const reportEvent = async (stage, requestId) => {
    const reply = await chrome.runtime.sendMessage({ type: 'RELAY_DUO_EVENT', event: { stage, requestId } });
    if (!reply?.success) throw new Error('ONBOARDING_DUO_EVENT_UNRECORDED');
  };
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'RELAY_DUO_SETTLED' && typeof message.id === 'string') { controllers.delete(message.id); return; }
    if (message?.type === 'RELAY_DUO_ABORT' && typeof message.id === 'string') {
      const entry = controllers.get(message.id);
      if (entry && ['aborted', 'timed-out'].includes(message.reason)) {
        entry.controller.abort();
        entry.failure ||= Promise.resolve(entry.intercepted).then(() => chrome.runtime.sendMessage({ type: 'RELAY_ENROLLMENT_FAILED', request: {
          origin: location.origin, rpId: entry.request.rpId, requestId: entry.request.requestId, reason: message.reason,
        } }));
        try { await entry.failure; } catch { window.postMessage({ type: 'RELAY_DUO_UNCERTAIN' }, location.origin); }
      }
      return;
    }
    if (message?.type !== 'RELAY_DUO_REQUEST' || typeof message.id !== 'string'
      || !['DUO_AUTOPILOT_SIGN', 'DUO_AUTOPILOT_ENROLL', 'RELAY_CAPABILITIES'].includes(message.operation)) return;
    const controller = new AbortController();
    const entry = { controller, request: message.request };
    controllers.set(message.id, entry);
    let before;
    try {
      if (message.operation === 'DUO_AUTOPILOT_ENROLL') {
        // Duo adds every method on one page, so each enrollment watches for its own heading.
        registration = undefined;
        priorHeadings = new Map(
          [...document.querySelectorAll('h1, h2, [role="heading"]')].map(element => [element, element.textContent.trim()]));
      }
      before = observation();
      const request = { ...message.request, origin: before.origin, usernames: before.accountNames };
      if (message.operation === 'DUO_AUTOPILOT_ENROLL') { entry.intercepted = reportEvent('intercepted', request.requestId); await entry.intercepted; }
      if (controller.signal.aborted) throw new Error('ONBOARDING_DUO_REVOKED');
      const reply = await chrome.runtime.sendMessage({ type: message.operation, request });
      if (controller.signal.aborted) throw new Error('ONBOARDING_DUO_REVOKED');
      if (message.operation !== 'RELAY_CAPABILITIES' && !sameObservation(before, observation())) throw new Error('ONBOARDING_DUO_SCOPE');
      if (!reply?.success) throw new Error('ONBOARDING_DUO_REFUSED');
      if (message.operation === 'DUO_AUTOPILOT_ENROLL' && reply.result.ok) {
        registration = { requestId: request.requestId, rpId: request.rpId, origin: location.origin };
        void checkAcceptance();
      }
      if (message.operation === 'DUO_AUTOPILOT_ENROLL') await reportEvent('replied', request.requestId);
      entry.replied = true;
      window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: true, result: reply.result }, location.origin);
    } catch {
      if (message.operation === 'DUO_AUTOPILOT_ENROLL') {
        entry.failure ||= chrome.runtime.sendMessage({ type: 'RELAY_ENROLLMENT_FAILED', request: {
          origin: location.origin, rpId: message.request.rpId, requestId: message.request.requestId, reason: 'request-refused',
        } });
        try { await entry.failure; } catch { window.postMessage({ type: 'RELAY_DUO_UNCERTAIN' }, location.origin); }
      }
      if (before && !sameObservation(before, observation())) {
        try { await chrome.runtime.sendMessage({ type: 'RELAY_SCOPE_LOST', request: { origin: before.origin, rpId: message.request.rpId } }); }
        catch { window.postMessage({ type: 'RELAY_DUO_UNCERTAIN' }, location.origin); }
      }
      window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: false }, location.origin);
    } finally { if (!entry.replied) controllers.delete(message.id); }
  });
  const checkAcceptance = async () => {
    if (!registration || registration.accepted) return;
    const pattern = /^Added security key(?: \([^()]{1,40}\))?$/;
    const matching = [...document.querySelectorAll('h1, h2, [role="heading"]')].filter(element =>
      element.getClientRects().length && pattern.test(element.textContent.trim()));
    const success = matching.filter(element => priorHeadings.get(element) !== element.textContent.trim());
    if (success.length !== 1) return;
    // Duo may re-render an old heading as a new element; only an extra copy of the text is new.
    const text = success[0].textContent.trim();
    if (matching.filter(element => element.textContent.trim() === text).length <= [...priorHeadings.values()].filter(prior => prior === text).length) return;
    registration.accepted = true;
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'RELAY_PORTAL_ACCEPTED', request: {
        requestId: registration.requestId, rpId: registration.rpId, origin: registration.origin } });
      if (!reply?.success) throw new Error('ONBOARDING_DUO_PORTAL_UNRECORDED');
    } catch { window.postMessage({ type: 'RELAY_DUO_UNCERTAIN' }, location.origin); }
  };
  const start = () => {
    new MutationObserver(() => { observation(); void checkAcceptance(); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
