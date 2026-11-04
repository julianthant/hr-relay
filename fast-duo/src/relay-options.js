export async function mountRelayOptions(initial) {
  const $ = id => document.getElementById(id);
  let profile = initial;
  let busy = false;
  let polling = false, actionGeneration = 0;
  let selected = 'key';
  let unavailable = false;
  const labels = { key: 'Security key', touch: 'Touch ID' };
  const kinds = { key: 'Fast Duo in this browser', touch: 'Touch ID on this computer' };
  const notes = {
    key: { idle: 'Ready to add in Duo.', pending: 'Waiting for Duo to add Security key.' },
    touch: { idle: 'Ready to add in Duo.', pending: 'Waiting for Duo to add Touch ID.' }
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
  $('accountList').after(element('p', 'relay-method-sync', 'Progress stays in sync with Relay.'));
  const states = { idle: 'Not started', pending: 'Pending', complete: 'Completed', unknown: 'Not confirmed', unavailable: 'Unavailable' };
  function render() {
    const blocked = unavailable === 'state';
    const focusedMethod = document.activeElement?.closest('.relay-method-card')?.dataset.method;
    const methods = profile.methods;
    if (methods[selected].state === 'complete') {
      const next = Object.keys(labels).find(method => methods[method].state !== 'complete');
      if (next) selected = next;
    }
    const list = $('accountList'); list.replaceChildren(); list.setAttribute('aria-busy', 'false');
    progress.replaceChildren();
    const selectionDisabled = busy;
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
      const note = state === 'complete' ? 'Verified by Relay.' : state === 'unknown' ? 'Check Duo, then start over.' : state === 'unavailable' ? 'Return to Relay to check setup.' : notes[method][state];
      item.append(head, track, element('span', 'relay-method-note', note)); list.append(item);
    }
    if (focusedMethod) list.querySelector(`[data-method="${focusedMethod}"]`).focus({ preventScroll: true });
    $('accountCount').textContent = `${Object.values(methods).filter(method => method.state === 'complete').length} of 2 completed`;
    const current = task(methods, blocked);
    $('editorTitle').textContent = current.title;
    $('instruction').textContent = current.instruction;
    $('primaryAction').textContent = current.action;
    $('primaryAction').disabled = busy || current.disabled === true;
    $('cancelCapture').hidden = methods[selected].state !== 'pending';
    $('cancelCapture').disabled = busy || blocked;
    $('returnRelay').hidden = current.action === 'Return to Relay';
    $('returnRelay').disabled = busy;
    $('message').hidden = !unavailable || unavailable === 'state';
    $('message').textContent = unavailable === 'return' ? 'Could not bring Relay forward. Select its window to review setup.' : 'Relay could not finish that action. Try again, or return to Relay.';
    $('message').setAttribute('role', 'alert');
  }
  const duoOption = { key: 'Security key', touch: 'Touch ID or Windows Hello' };
  function task(methods, blocked) {
    const attempt = methods[selected], label = labels[selected];
    if (blocked) return { title: 'Reconnect to Relay', instruction: 'This page lost contact with Relay. Open setup again from Relay.', action: 'Return to Relay', run: () => command('RELAY_RETURN') };
    if (Object.values(methods).every(method => method.state === 'complete')) return { title: 'Both methods added', instruction: 'Security key and Touch ID are verified. Return to Relay to finish sign-up.', action: 'Return to Relay', run: () => command('RELAY_RETURN') };
    if (attempt.state === 'unavailable') return { title: `${label} unavailable`, instruction: 'Relay cannot set up this method from here. Return to Relay to check setup.', action: 'Return to Relay', run: () => command('RELAY_RETURN') };
    if (attempt.state === 'unknown') return { title: `Check ${label} in Duo`, instruction: 'Relay could not confirm this attempt. In Duo, open Manage devices and remove any device you do not recognize, then start over.', action: `Start ${label} over`, run: () => start(selected) };
    if (attempt.state === 'pending' && attempt.ceremonyObserved) return { title: `Finishing ${label}`, instruction: `Relay finishes this method when Duo shows that ${label} was added. If Duo already lists it and this page has not moved on, confirm it here.`,
      action: 'Duo added this device', run: () => command('RELAY_CONFIRM', selected, attempt.attemptId) };
    if (attempt.state === 'pending') return { title: `Add ${label} in Duo`, instruction: `In Duo, approve the sign-in on your phone. Then choose Other options, Manage devices, Add a device, ${duoOption[selected]}.`, action: 'Show Duo', run: () => command('RELAY_OPEN_PORTAL') };
    return { title: `Set up ${label}`, instruction: `Relay opens Duo and signs you in. You then add ${duoOption[selected]} as a new device.`, action: `Set up ${label}`, run: () => start(selected) };
  }
  async function start(method) {
    await command('RELAY_START', method);
    if (profile.methods[method].state === 'pending') await command('RELAY_OPEN_PORTAL');
  }
  async function command(type, method, attemptId) {
    const stateRead = type === 'STATE';
    if (busy || stateRead && polling) return;
    if (stateRead) polling = true;
    else { busy = true; actionGeneration++; }
    const generation = actionGeneration;
    const focusedMethod = document.activeElement?.closest('.relay-method-card')?.dataset.method;
    if (!stateRead) render();
    try {
      const response = await chrome.runtime.sendMessage({ type, ...(method === undefined ? {} : { method }), ...(attemptId === undefined ? {} : { attemptId }) });
      if (stateRead && generation !== actionGeneration) return;
      if (!response?.success || response.result?.relaySetup !== true) throw new Error('Relay setup refused');
      const next = response.result.profile;
      if (next.operationId !== profile.operationId || next.profileId !== profile.profileId) throw new Error('Relay setup replaced');
      profile = next; if (type !== 'STATE' || unavailable === 'state') unavailable = false;
    } catch {
      if (type === 'RELAY_RETURN') unavailable = 'return';
      else if ((!stateRead || generation === actionGeneration) && (type !== 'STATE' || !unavailable)) unavailable = type === 'STATE' ? 'state' : 'action';
    }
    finally { if (stateRead) polling = false; else busy = false; render(); if (focusedMethod && document.activeElement === document.body) $('accountList').querySelector(`[data-method="${focusedMethod}"]`).focus({ preventScroll: true }); }
  }
  $('returnRelay').addEventListener('click', () => { void command('RELAY_RETURN'); });
  $('primaryAction').addEventListener('click', () => { void task(profile.methods, unavailable === 'state').run(); });
  $('cancelCapture').addEventListener('click', () => { void command('RELAY_CANCEL', selected, profile.methods[selected].attemptId); });
  const timer = setInterval(() => { if (!busy) void command('STATE'); }, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  render();
}
