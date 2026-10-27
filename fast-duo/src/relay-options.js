export async function mountRelayOptions(initial) {
  const $ = id => document.getElementById(id);
  let profile = initial;
  let busy = false;
  let selected = 'key';
  let unavailable = false;
  for (const selector of ['.tabs', '.activity', '#addAccount', '#pause', '#legacy', '#intro', '#accountForm', '#aliasForm', '#accountActions', '#advanced', '#editDetails', '#closeEditor', '#refreshTabs', '#duoTab', 'label[for="duoTab"]']) {
    document.querySelector(selector).hidden = true;
  }
  $('editor').hidden = false;
  $('connection').hidden = false;
  $('openLogin').hidden = false;
  $('openLogin').textContent = 'Open duo.ucsd.edu';
  $('editorTitle').textContent = 'Set up your sign-in methods';
  document.querySelector('.brand small').textContent = 'Relay sign-in setup';
  document.querySelector('.brand span').firstChild.textContent = 'Fast Duo';
  document.title = 'Fast Duo · Relay sign-in setup';
  document.querySelector('footer > span').firstChild.textContent = 'Fast Duo ';
  document.querySelector('footer > span:last-child').textContent = 'Private Relay sign-in methods.';
  $('accountListHeading').textContent = 'Relay sign-in methods';
  document.querySelector('#connection h3').textContent = 'Set up a sign-in method';
  document.querySelector('#connection > p').textContent = 'Open Duo in this same window and sign in once. Complete MFA, then choose Other options → Manage devices.';
  document.querySelector('label[for="transport"]').textContent = 'Sign-in method';
  $('transport').nextElementSibling.textContent = 'Relay needs both methods. Set up each method once.';
  $('startCapture').textContent = 'Set up selected method';
  document.querySelector('.setup-panel').setAttribute('aria-labelledby', 'editorTitle');
  $('duoTab').closest('.input-action').hidden = true;
  $('duoTab').closest('.input-action').nextElementSibling.textContent = 'Relay verifies the exact Duo page and account before capture.';
  document.querySelector('.local-note').textContent = 'Private Relay draft';
  document.querySelector('.page-heading h1').textContent = 'Duo setup for Relay';
  document.querySelector('.page-heading p').textContent = 'A software security key and native Touch ID must both be verified.';
  $('globalDetail').textContent = 'Open Duo in this same window. Relay uses your saved profile details to sign in once; complete MFA yourself.';
  $('transport').options[1].textContent = 'Touch ID on this Mac (native)';
  const labels = { key: 'Security key', touch: 'Touch ID on this Mac' };
  const states = { idle: 'Not started', pending: 'Waiting', complete: 'Verified', unknown: 'Needs review', unavailable: 'Unavailable' };
  function render() {
    const methods = profile.methods;
    if (methods[selected].state === 'complete' && methods.touch.state !== 'complete') selected = 'touch';
    $('transport').value = selected === 'key' ? 'usb' : 'internal';
    $('globalStatus').textContent = unavailable ? 'Setup unavailable' : Object.values(methods).some(method => method.state === 'unknown') ? 'Sign-in method needs review' : Object.values(methods).every(method => method.state === 'complete') ? 'Both methods verified' : Object.values(methods).some(method => method.state === 'unavailable') ? 'Sign-in method unavailable' : Object.values(methods).some(method => method.state === 'pending') ? 'Waiting for Duo' : Object.values(methods).some(method => method.state === 'complete') ? 'One method verified' : 'Sign-in methods not started';
    $('globalDetail').textContent = unavailable === 'action' ? 'Duo could not complete this setup action. Return to Relay to check setup.' : unavailable ? 'Setup authority is unavailable. Return to Relay.' : Object.values(methods).some(method => method.state === 'unknown') ? 'A method may already be added in Duo. Review it without enrolling it again.' : Object.values(methods).every(method => method.state === 'complete') ? 'Both sign-in methods are verified. Return to Relay to finish your profile.' : Object.values(methods).some(method => method.state === 'pending') ? 'Complete the selected method in Duo. Capture alone does not prove enrollment.' : 'Open Duo in this same window. Relay uses your saved profile details to sign in once; complete MFA yourself.';
    const list = $('accountList'); list.replaceChildren(); list.setAttribute('aria-busy', 'false');
    for (const [method, label] of Object.entries(labels)) {
      const item = document.createElement('article'); item.className = 'account';
      const name = document.createElement('h3'); name.textContent = label;
      const state = document.createElement('span'); state.className = 'badge'; state.textContent = states[methods[method].state];
      item.append(name, state); list.append(item);
    }
    $('accountCount').textContent = '2 methods';
    const attempt = methods[selected], pending = attempt.state === 'pending';
    document.querySelector('#connection .fine-print').textContent = unavailable || attempt.state === 'unavailable' ? 'Setup is unavailable. Return to Relay to check your profile session.'
      : attempt.state === 'unknown' ? 'This method may already have been added in Duo. Review your devices; do not add this method again.'
      : attempt.state === 'complete' ? 'This sign-in method is verified. No further enrollment is needed.'
      : selected === 'touch'
      ? 'Choose Touch ID in Duo. This method uses the native Mac prompt, with software interception disabled.'
      : 'Then select Add a device in Duo. FastDuo creates the software key only when Duo requests it.';
    $('transport').disabled = busy || Object.values(methods).some(method => method.state === 'pending');
    $('startCapture').disabled = busy || unavailable || attempt.state !== 'idle';
    $('openLogin').disabled = busy || unavailable;
    $('captureState').hidden = !pending;
    $('cancelCapture').disabled = busy || unavailable || !pending;
    $('captureTitle').textContent = selected === 'touch' ? 'Waiting for native Touch ID' : 'Waiting for Duo security key enrollment';
    $('captureText').textContent = 'Complete the selected method in Duo. Capture alone does not prove enrollment.';
    const pendingKeys = $('pendingKeys'); pendingKeys.replaceChildren();
    if (pending && attempt.ceremonyObserved) {
      const button = document.createElement('button'); button.className = 'primary full';
      button.textContent = 'Duo confirmed the device was added';
      button.disabled = busy || unavailable || selected === 'touch' && !attempt.portalAccepted;
      const method = selected, attemptId = attempt.attemptId;
      button.addEventListener('click', () => { void command('RELAY_CONFIRM', method, attemptId); });
      pendingKeys.append(button);
    }
    $('message').hidden = !unavailable && !['unknown', 'unavailable'].includes(attempt.state);
    $('message').textContent = unavailable === 'action' ? 'Duo could not complete this setup action. Return to Relay; do not repeat an unknown enrollment.' : unavailable ? 'Setup authority is unavailable. Return to Relay.' : attempt.state === 'unknown' ? `${labels[selected]} needs review. It may already be added in Duo; do not add this method again.` : `${labels[selected]} is unavailable. Return to Relay to check setup.`;
    $('message').setAttribute('role', 'alert');
  }
  async function command(type, method, attemptId) {
    if (busy) return;
    busy = true; render();
    try {
      const response = await chrome.runtime.sendMessage({ type, ...(method === undefined ? {} : { method }), ...(attemptId === undefined ? {} : { attemptId }) });
      if (!response?.success || response.result?.relaySetup !== true) throw new Error('Relay setup refused');
      const next = response.result.profile;
      if (next.operationId !== profile.operationId || next.profileId !== profile.profileId) throw new Error('Relay setup replaced');
      profile = next; if (type !== 'STATE' || unavailable === 'state') unavailable = false;
    } catch { if (type !== 'STATE' || !unavailable) unavailable = type === 'STATE' ? 'state' : 'action'; }
    finally { busy = false; render(); }
  }
  $('transport').addEventListener('change', () => { selected = $('transport').value === 'usb' ? 'key' : 'touch'; render(); });
  $('openLogin').addEventListener('click', () => { void command('RELAY_OPEN_PORTAL'); });
  $('startCapture').addEventListener('click', () => { void command('RELAY_START', selected); });
  $('cancelCapture').addEventListener('click', () => { void command('RELAY_CANCEL', selected, profile.methods[selected].attemptId); });
  const timer = setInterval(() => { if (!busy) void command('STATE'); }, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  render();
}
