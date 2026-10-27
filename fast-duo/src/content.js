(() => {
  function bridge(reqType, resType, runtimeType) {
    window.addEventListener('message', async event => {
      if (event.source !== window || event.origin !== location.origin) return;
      const d = event.data;
      if (!d || d.type !== reqType || typeof d.nonce !== 'number') return;
      let response;
      try {
        const reply = await chrome.runtime.sendMessage({ type: runtimeType,
          request: { ...d.request, origin: location.origin, usernames: globalThis.DuoUsername.findUsernames(document) } });
        response = reply?.success ? reply.result : { ok: false, reason: 'Extension unavailable.' };
      } catch { response = { ok: false, reason: 'Extension reloaded. Refresh this Duo page.' }; }
      window.postMessage({ type: resType, nonce: d.nonce, response }, location.origin);
    });
  }
  bridge('DUO_AUTOPILOT_REQ', 'DUO_AUTOPILOT_RES', 'DUO_AUTOPILOT_SIGN');
  bridge('DUO_AUTOPILOT_ENROLL_REQ', 'DUO_AUTOPILOT_ENROLL_RES', 'DUO_AUTOPILOT_ENROLL');

  let checking = false;
  let clicked = false;
  async function checkTrust() {
    if (checking || clicked) return;
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
    const observer = new MutationObserver(checkTrust);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    void checkTrust();
    setTimeout(() => observer.disconnect(), 60000);
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
