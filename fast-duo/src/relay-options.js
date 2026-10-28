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
  const labels = { key: 'Security key', touch: 'Touch ID' };
  const kinds = { key: 'Software key in this browser', touch: 'Built-in sensor on this Mac' };
  const notes = {
    key: { idle: 'Fast Duo creates the software key only when Duo requests it.', pending: 'Waiting for Duo security key enrollment.' },
    touch: { idle: 'Uses the native Mac prompt, with software interception disabled.', pending: 'Waiting for native Touch ID.' }
  };
  const paths = {
    key: ['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'],
    touch: ['M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4', 'M14 13.12c0 2.38 0 6.38-1 8.88', 'M17.29 21.02c.12-.6.43-2.3.5-3.02', 'M2 12a10 10 0 0 1 18-6', 'M2 16h.01', 'M21.8 16c.2-2 .131-5.354 0-6', 'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2', 'M8.65 22c.21-.66.45-1.32.57-2', 'M9 6.8a6 6 0 0 1 9 5.2v2'],
    idle: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
    pending: ['M21 12a9 9 0 1 1-6.219-8.56'],
    complete: ['m20 6-11 11-5-5'],
    failed: ['m18 6-12 12', 'm6 6 12 12']
  };
  function svg(kind) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
    for (const d of paths[kind]) { const path = document.createElementNS(icon.namespaceURI, 'path'); path.setAttribute('d', d); icon.append(path); }
    if (kind === 'idle') icon.setAttribute('stroke-dasharray', '3 3');
    return icon;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  $('accountList').className = 'relay-method-list';
  const progress = element('div', 'relay-method-progress'); progress.setAttribute('aria-hidden', 'true');
  $('accountList').before(progress);
  $('accountList').after(element('p', 'relay-method-sync', 'Same status as the Relay sign-up step. Updated every second.'));
  const states = { idle: 'Not started', pending: 'Pending', complete: 'Completed', unknown: 'Failed', unavailable: 'Failed' };
  function render() {
    const focusedMethod = document.activeElement?.closest('.relay-method-card')?.dataset.method;
    const methods = profile.methods;
    if (methods[selected].state === 'complete' && methods.touch.state !== 'complete') selected = 'touch';
    $('transport').value = selected === 'key' ? 'usb' : 'internal';
    $('globalStatus').textContent = unavailable ? 'Setup unavailable' : Object.values(methods).some(method => method.state === 'unknown') ? 'Setup failed' : Object.values(methods).every(method => method.state === 'complete') ? 'Both methods completed' : Object.values(methods).some(method => method.state === 'unavailable') ? 'Setup failed' : Object.values(methods).some(method => method.state === 'pending') ? 'Pending' : Object.values(methods).some(method => method.state === 'complete') ? 'One method completed' : 'Sign-in methods not started';
    $('globalDetail').textContent = unavailable === 'action' ? 'Duo could not complete this setup action. Return to Relay to check setup.' : unavailable ? 'Setup authority is unavailable. Return to Relay.' : Object.values(methods).some(method => method.state === 'unknown') ? 'Relay could not confirm that setup completed. Review your Duo devices without repeating this attempt.' : Object.values(methods).every(method => method.state === 'complete') ? 'Both sign-in methods are verified. Return to Relay to finish your profile.' : Object.values(methods).some(method => method.state === 'pending') ? 'Complete the selected method in Duo. Capture alone does not prove enrollment.' : 'Open Duo in this same window. Relay uses your saved profile details to sign in once; complete MFA yourself.';
    const list = $('accountList'); list.replaceChildren(); list.setAttribute('aria-busy', 'false');
    progress.replaceChildren();
    const selectionDisabled = busy || Object.values(methods).some(method => method.state === 'pending');
    for (const [method, label] of Object.entries(labels)) {
      const state = methods[method].state;
      const failed = state === 'unknown' || state === 'unavailable';
      const tone = failed ? 'failed' : state;
      const segment = element('span', ''); segment.dataset.state = tone; progress.append(segment);
      const item = element('button', 'relay-method-card'); item.type = 'button'; item.dataset.state = tone; item.dataset.method = method;
      item.setAttribute('aria-pressed', String(method === selected)); item.disabled = selectionDisabled;
      item.addEventListener('click', () => { if (!selectionDisabled) { selected = method; render(); } });
      const head = element('span', 'relay-method-head');
      const tile = element('span', 'relay-method-icon'); tile.append(svg(method));
      const identity = element('span', 'relay-method-identity'); identity.append(element('strong', '', label), element('span', '', kinds[method]));
      const pill = element('span', 'relay-method-pill'); pill.append(svg(tone), document.createTextNode(states[state]));
      head.append(tile, identity, pill);
      const track = element('ol', 'relay-method-track'); track.setAttribute('aria-label', `${label} progress`);
      const tones = state === 'idle' ? ['off', 'off', 'off'] : state === 'complete' ? ['complete', 'complete', 'complete'] : ['complete', failed ? 'failed' : 'pending', 'off'];
      for (const [index, text] of ['Started', failed ? 'Not confirmed' : 'Added in Duo', 'Confirmed by Relay'].entries()) {
        const step = element('li', '', text); step.dataset.state = tones[index]; track.append(step);
      }
      const note = state === 'complete' ? 'This sign-in method is verified. No further enrollment is needed.' : failed ? 'Relay could not confirm that setup completed. Review your Duo devices; do not repeat this attempt.' : notes[method][state];
      item.append(head, track, element('span', 'relay-method-note', note)); list.append(item);
    }
    if (focusedMethod) list.querySelector(`[data-method="${focusedMethod}"]`).focus({ preventScroll: true });
    $('accountCount').textContent = `${Object.values(methods).filter(method => method.state === 'complete').length} of 2 completed`;
    const attempt = methods[selected], pending = attempt.state === 'pending';
    document.querySelector('#connection .fine-print').textContent = unavailable || attempt.state === 'unavailable' ? 'Setup is unavailable. Return to Relay to check your profile session.'
      : attempt.state === 'unknown' ? 'Relay could not confirm that setup completed. Review your Duo devices; do not repeat this attempt.'
      : attempt.state === 'complete' ? 'This sign-in method is verified. No further enrollment is needed.'
      : selected === 'touch'
      ? 'Choose Touch ID in Duo. This method uses the native Mac prompt, with software interception disabled.'
      : 'Then select Add a device in Duo. FastDuo creates the software key only when Duo requests it.';
    $('transport').disabled = selectionDisabled;
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
    $('message').textContent = unavailable === 'action' ? 'Duo could not complete this setup action. Return to Relay; do not repeat an unconfirmed attempt.' : unavailable ? 'Setup authority is unavailable. Return to Relay.' : attempt.state === 'unknown' ? `${labels[selected]} setup failed. Relay could not confirm completion; review your Duo devices without repeating this attempt.` : `${labels[selected]} is unavailable. Return to Relay to check setup.`;
    $('message').setAttribute('role', 'alert');
  }
  async function command(type, method, attemptId) {
    if (busy) return;
    const focusedMethod = document.activeElement?.closest('.relay-method-card')?.dataset.method;
    busy = true; render();
    try {
      const response = await chrome.runtime.sendMessage({ type, ...(method === undefined ? {} : { method }), ...(attemptId === undefined ? {} : { attemptId }) });
      if (!response?.success || response.result?.relaySetup !== true) throw new Error('Relay setup refused');
      const next = response.result.profile;
      if (next.operationId !== profile.operationId || next.profileId !== profile.profileId) throw new Error('Relay setup replaced');
      profile = next; if (type !== 'STATE' || unavailable === 'state') unavailable = false;
    } catch { if (type !== 'STATE' || !unavailable) unavailable = type === 'STATE' ? 'state' : 'action'; }
    finally { busy = false; render(); if (focusedMethod && document.activeElement === document.body) $('accountList').querySelector(`[data-method="${focusedMethod}"]`).focus({ preventScroll: true }); }
  }
  $('transport').addEventListener('change', () => { selected = $('transport').value === 'usb' ? 'key' : 'touch'; render(); });
  $('openLogin').addEventListener('click', () => { void command('RELAY_OPEN_PORTAL'); });
  $('startCapture').addEventListener('click', () => { void command('RELAY_START', selected); });
  $('cancelCapture').addEventListener('click', () => { void command('RELAY_CANCEL', selected, profile.methods[selected].attemptId); });
  const timer = setInterval(() => { if (!busy) void command('STATE'); }, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  render();
}
