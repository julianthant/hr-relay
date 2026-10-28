(() => {
  const native = globalThis.RelayNative;
  const controllers = new Map();
  let registration;
  let accepted = false;
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
    for (const controller of controllers.values()) controller.abort();
  });
  const sameObservation = (before, after) => before.documentActive && after.documentActive
    && before.url === after.url && before.origin === after.origin && before.accountRevision === after.accountRevision
    && before.accountNames.length === 1 && JSON.stringify(before.accountNames) === JSON.stringify(after.accountNames);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'RELAY_OBSERVE') return false;
    sendResponse(observation());
    return false;
  });
  const nativeFailure = async request => {
    await chrome.runtime.sendMessage({ type: 'RELAY_NATIVE_FAILED', request: { origin: location.origin,
      rpId: request.rpId, requestId: request.requestId } });
  };
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'RELAY_DUO_ABORT' && typeof message.id === 'string') { controllers.get(message.id)?.abort(); return; }
    if (message?.type !== 'RELAY_DUO_REQUEST' || typeof message.id !== 'string'
      || !['DUO_AUTOPILOT_SIGN', 'DUO_AUTOPILOT_ENROLL', 'RELAY_CAPABILITIES'].includes(message.operation)) return;
    const controller = new AbortController();
    controllers.set(message.id, controller);
    let before;
    try {
      if (message.operation === 'DUO_AUTOPILOT_ENROLL') priorHeadings = new Map(
        [...document.querySelectorAll('h1, h2, [role="heading"]')].map(element => [element, element.textContent.trim()]));
      before = observation();
      const request = { ...message.request, origin: before.origin, usernames: before.accountNames };
      const reply = await chrome.runtime.sendMessage({ type: message.operation, request });
      if (controller.signal.aborted) throw new Error('ONBOARDING_DUO_REVOKED');
      if (reply?.success && reply.result.native) {
        let result;
        try {
          if (!sameObservation(before, observation())) throw new Error('ONBOARDING_DUO_SCOPE');
          result = await native.create(message.nativeOptions, { rpId: request.rpId, origin: before.origin, challenge: request.challenge, username: request.username, userHandle: request.userHandle }, controller.signal);
          if (!sameObservation(before, observation())) throw new Error('ONBOARDING_DUO_SCOPE');
          const receipt = await chrome.runtime.sendMessage({ type: 'RELAY_NATIVE_CREATED', request: {
            origin: location.origin, rpId: request.rpId, requestId: request.requestId,
            credentialId: result.credentialId, attachment: result.attachment,
          } });
          if (!receipt?.success || controller.signal.aborted || !sameObservation(before, observation())) throw new Error('ONBOARDING_DUO_NATIVE_UNRECORDED');
        } catch (error) {
          try { await nativeFailure(request); }
          catch (reportError) { throw new AggregateError([error, reportError], 'ONBOARDING_DUO_NATIVE_UNRECORDED', { cause: reportError }); }
          throw error;
        }
        registration = { requestId: request.requestId, rpId: request.rpId, origin: location.origin, method: 'touch' };
        void checkAcceptance();
        window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: true, result: { ...result, ok: true, native: true } }, location.origin);
      } else {
        if (!sameObservation(before, observation())) throw new Error('ONBOARDING_DUO_SCOPE');
        if (reply?.success && message.operation === 'DUO_AUTOPILOT_ENROLL' && reply.result.ok) {
          registration = { requestId: request.requestId, rpId: request.rpId, origin: location.origin, method: 'key' };
          void checkAcceptance();
        }
        window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: reply?.success === true, result: reply?.result }, location.origin);
      }
    } catch {
      if (before && !sameObservation(before, observation())) {
        try { await chrome.runtime.sendMessage({ type: 'RELAY_SCOPE_LOST', request: { origin: before.origin, rpId: message.request.rpId } }); }
        catch { window.postMessage({ type: 'RELAY_DUO_UNCERTAIN' }, location.origin); }
      }
      window.postMessage({ type: 'RELAY_DUO_RESPONSE', id: message.id, success: false }, location.origin);
    } finally { controllers.delete(message.id); }
  });
  const checkAcceptance = async () => {
    if (!registration || accepted) return;
    const pattern = registration.method === 'touch' ? /^Added Touch ID$/ : /^Added security key$/;
    const success = [...document.querySelectorAll('h1, h2, [role="heading"]')].filter(element =>
      element.getClientRects().length && pattern.test(element.textContent.trim()) && priorHeadings.get(element) !== element.textContent.trim());
    if (success.length !== 1) return;
    accepted = true;
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
