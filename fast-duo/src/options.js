const initial = await chrome.runtime.sendMessage({ type: 'STATE' });
if (initial?.success && initial.result?.relaySetup === true) {
  const { mountRelayOptions } = await import('./relay-options.js');
  await mountRelayOptions(initial.result.profile);
} else if (chrome.runtime.getManifest().background.service_worker === 'src/relay-background.js') {
  document.getElementById('globalStatus').textContent = 'Setup unavailable';
  document.getElementById('globalDetail').textContent = 'Return to Relay to check the original draft.';
  document.getElementById('addAccount').disabled = true;
} else {
const $ = id => document.getElementById(id);
if (chrome.runtime.getURL('').startsWith('safari-web-extension://')) {
  $('installInstructions').textContent = 'Open the Safari app package, then enable Duo Autopilot in Safari Settings → Extensions. This local build needs Allow unsigned extensions in Developer settings. Allow access to your Duo site, then reload the Duo page.';
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
let state;
let selectedId = null;
let removeConfirmation = null;
async function request(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, data });
  if (!response?.success) throw new Error(response?.error || 'The extension did not respond. Reload this page.');
  return response.result;
}
function message(text, error = false) {
  $('message').textContent = text;
  $('message').className = 'notice' + (error ? ' error' : '');
  $('message').hidden = !text;
  $('message').setAttribute('role', error ? 'alert' : 'status');
}
async function action(button, work) {
  button.disabled = true;
  try { await work(); } catch (error) { message(error.message, true); }
  finally { button.disabled = false; if (state && button.id === "startCapture") renderConnection(); }
}
function render() {
  const usable = state.credentials.filter(c => c.status === 'ready' && state.accounts.some(a => a.id === c.accountId && a.enabled));
  $('globalStatus').textContent = !state.settings.enabled ? 'Autopilot is paused' : usable.length ? 'Autopilot is active' : 'Ready when you are';
  $('globalDetail').textContent = !state.settings.enabled ? 'Your keys are saved. Duo uses your usual authentication method.' : usable.length ? 'Watching for matching Duo logins in this browser.' : 'Connect an account to start automatic Duo authentication.';
  $('pause').textContent = state.settings.enabled ? 'Pause' : 'Resume';
  $('pause').disabled = false;
  $('accountCount').textContent = `${state.accounts.length} ${state.accounts.length === 1 ? 'account' : 'accounts'}`;
  $('accountList').setAttribute('aria-busy','false');
  $('accountList').innerHTML = state.accounts.length ? state.accounts.map(a => {
    const keys = state.credentials.filter(c => c.accountId === a.id);
    const ready = keys.some(c => c.status === 'ready');
    const status = !a.enabled ? 'Paused' : ready ? 'Connected' : keys.length ? 'Finish in Duo' : 'Needs setup';
    const kinds = [...new Set(keys.map(c => c.transport === 'usb' ? 'Security key' : 'Platform key'))].join(' · ') || 'No key connected yet';
    return `<article class="account"><div class="account-head"><span class="avatar" aria-hidden="true">${escape(a.username.slice(0,2))}</span><div class="account-identity"><h3>${escape(a.label)}</h3><p>${escape(a.username)}</p>${a.aliases?.length ? `<p class="account-aliases">Also matches: ${escape(a.aliases.join(', '))}</p>` : ''}</div><span class="badge ${a.enabled && ready ? 'ready' : ''}">${status}</span></div><div class="account-bottom"><span class="key-types"><img src="icons/key-round.svg" alt="">${escape(kinds)}</span><button class="quiet small" data-edit="${escape(a.id)}" aria-label="${ready ? 'Manage' : 'Set up'} ${escape(a.username)}">${ready ? 'Manage' : 'Set up'} <span aria-hidden="true">↗</span></button></div></article>`;
  }).join('') : '<p class="empty">No accounts yet. Add your Duo username, then follow the guided setup.</p>';
  $('events').innerHTML = state.events.length ? state.events.map(e => {
    const a = state.accounts.find(a => a.id === e.accountId);
    return `<li><span>${a ? `<strong>${escape(a.username)}</strong><br>` : ''}${escape(e.message)}</span><time datetime="${new Date(e.at).toISOString()}">${escape(new Date(e.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}</time></li>`;
  }).join('') : '<li>Your next connection or key request will appear here.</li>';
  for (const key of ['enabled','trustClick','toast']) $(key).checked = state.settings[key];
  $('legacy').hidden = !state.credentials.some(c => !c.accountId);
  const priorOwner = $('legacyOwner').value;
  $('legacyOwner').innerHTML = '<option value="">Choose their account</option>' + state.accounts.map(a => `<option value="${escape(a.id)}">${escape(a.username)}</option>`).join('');
  $('legacyOwner').value = priorOwner;
  renderConnection();
}
function renderConnection() {
  const account = state.accounts.find(a => a.id === selectedId);
  $('connection').hidden = !account;
  $('aliasForm').hidden = !account;
  $('accountActions').hidden = !account;
  $('advanced').hidden = !account;
  if (!account) { $('captureState').hidden = true; $('pendingKeys').innerHTML = ''; return; }
  $('openLogin').hidden = !account.loginUrl;
  $('toggleAccount').textContent = account.enabled ? 'Pause account' : 'Resume account';
  const capture = state.enrollment;
  const armed = capture?.accountId === selectedId;
  $('captureState').hidden = !armed;
  $('startCapture').disabled = !state.settings.enabled || !account.enabled || !!capture;
  if (armed) {
    $('captureTitle').textContent = 'Listening in your Duo tab';
    $('captureText').textContent = capture.error || `Now choose Add a device in Duo, then the device type selected here. Capture expires at ${new Date(capture.expiresAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
  }
  $('pendingKeys').innerHTML = state.credentials.filter(c => c.accountId === selectedId && c.status === 'pending').map(c => `<div class="pending"><h3>Key captured</h3><p>Finish the device setup in Duo. Only confirm below after Duo says the device was added. A matching test login can also activate this key.</p><button class="primary full" data-confirm="${escape(c.credentialId)}">Duo confirmed the device was added</button><button class="quiet full" data-discard="${escape(c.credentialId)}">Duo did not finish. Discard this key.</button></div>`).join('');
}
function openEditor(id) {
  selectedId = id;
  const account = state.accounts.find(a => a.id === id);
  $('intro').hidden = true; $('editor').hidden = false;
  $('editorTitle').textContent = account ? account.username : 'Add an account';
  $('accountForm').hidden = !!account;
  $('editDetails').hidden = !account;
  $('editDetails').textContent = 'Edit account details';
  document.querySelector('.setup-panel').setAttribute('aria-labelledby', 'editorTitle');
  $('username').value = account?.username || '';
  $('aliases').value = (account?.aliases || []).join(', ');
  $('label').value = account?.label || '';
  $('loginUrl').value = account?.loginUrl || '';
  $('saveAccount').textContent = account ? 'Save changes' : 'Create account';
  removeConfirmation = null; $('removeHelp').hidden = true; $('removeAccount').textContent = 'Remove account';
  $('advanced').open = false;
  $('importFile').value = '';
  renderConnection();
  $('editor').scrollIntoView({ block:'nearest' });
  (account ? $('editorTitle') : $('username')).focus({preventScroll:true});
  if (account) void refreshTabs().catch(error => message(error.message,true));
}
async function refreshTabs() {
  const tabs = await request('DUO_TABS');
  const previous = $('duoTab').value;
  $('duoTab').innerHTML = '<option value="">Choose a Duo tab</option>' + tabs.map(t => `<option value="${t.id}">${escape(t.title)} · ${escape(new URL(t.url).hostname)} · tab ${t.id}</option>`).join('');
  if (tabs.some(t => String(t.id) === previous)) $('duoTab').value = previous;
  else if (tabs.length === 1) $('duoTab').value = String(tabs[0].id);
  if (!tabs.length) $('duoTab').innerHTML = '<option value="">No Duo tab open yet</option>';
}
async function mutate(type, data) { state = await request(type,data); render(); }
for (const tab of document.querySelectorAll('[data-page]')) tab.addEventListener('click', () => {
  for (const button of document.querySelectorAll('[data-page]')) { button.classList.toggle('selected', button === tab); if (button === tab) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
  for (const name of ['accounts','preferences','help']) $(name+'Page').hidden = name !== tab.dataset.page;
});
$('editDetails').addEventListener('click', () => { $('accountForm').hidden = !$('accountForm').hidden; $('editDetails').textContent = $('accountForm').hidden ? 'Edit account details' : 'Hide account details'; if (!$('accountForm').hidden) $('username').focus(); });
$('addAccount').addEventListener('click', () => openEditor(null));
$('closeEditor').addEventListener('click', () => { selectedId = null; $('editor').hidden = true; $('intro').hidden = false; document.querySelector('.setup-panel').setAttribute('aria-labelledby', 'setupHeading'); $('addAccount').focus(); });
$('accountList').addEventListener('click', event => { const button = event.target.closest('[data-edit]'); if (button) openEditor(button.dataset.edit); });
$('accountForm').addEventListener('submit', event => {
  event.preventDefault();
  void action($('saveAccount'), async () => {
    const username = $('username').value.trim().toLowerCase();
    await mutate('SAVE_ACCOUNT',{ id:selectedId, username, label:$('label').value, loginUrl:$('loginUrl').value, enabled:state.accounts.find(a => a.id === selectedId)?.enabled ?? true });
    openEditor(state.accounts.find(a => a.username === username).id);
    message('Account saved. Manage shared usernames and keys below.');
  });
});
$('aliasForm').addEventListener('submit', event => {
  event.preventDefault();
  void action($('saveAliases'), async () => {
    const aliases = $('aliases').value.split(',').map(name => name.trim()).filter(Boolean);
    await mutate('SAVE_ALIASES', { accountId: selectedId, aliases });
    $('aliases').value = (state.accounts.find(a => a.id === selectedId)?.aliases || []).join(', ');
    message('Alternate usernames saved. They share this account’s keys.');
  });
});
$('pause').addEventListener('click', () => action($('pause'), () => mutate('SAVE_SETTINGS', {enabled:!state.settings.enabled})));
for (const key of ['enabled','trustClick','toast']) $(key).addEventListener('change', () => action($(key), async () => {
  try { await mutate('SAVE_SETTINGS',{[key]:$(key).checked}); } finally { $(key).checked = state.settings[key]; }
}));
$('refreshTabs').addEventListener('click', () => action($('refreshTabs'),refreshTabs));
$('openLogin').addEventListener('click', () => action($('openLogin'), async () => {
  const account = state.accounts.find(a => a.id === selectedId);
  if (account?.loginUrl) await chrome.tabs.create({url:account.loginUrl});
}));
$('startCapture').addEventListener('click', () => action($('startCapture'), async () => {
  if (!$('duoTab').value) throw new Error('Open your Duo device-management page, then refresh the tab list.');
  await mutate('ARM',{accountId:selectedId,tabId:Number($('duoTab').value),transport:$('transport').value});
  message('Capture started. Add your device in the selected Duo tab.');
}));
$('cancelCapture').addEventListener('click', () => action($('cancelCapture'), () => mutate('CANCEL')));
$('pendingKeys').addEventListener('click', event => {
  const button = event.target.closest('[data-confirm], [data-discard]');
  if (button) void action(button, () => mutate(button.dataset.confirm ? 'CONFIRM' : 'DISCARD_PENDING',{credentialId:button.dataset.confirm || button.dataset.discard}));
});
$('toggleAccount').addEventListener('click', () => action($('toggleAccount'), () => mutate('TOGGLE_ACCOUNT',{accountId:selectedId})));
$('removeAccount').addEventListener('click', () => action($('removeAccount'), async () => {
  if (removeConfirmation !== selectedId) { removeConfirmation = selectedId; $('removeAccount').textContent = 'Confirm removal'; $('removeHelp').hidden = false; return; }
  await mutate('REMOVE_ACCOUNT',{accountId:selectedId});
  $('closeEditor').click(); message('Account and local keys removed. You can remove the registered device separately in Duo.');
}));
$('importKeys').addEventListener('click', () => action($('importKeys'), async () => {
  const file = $('importFile').files[0];
  if (!file || file.size > 1024*1024) throw new Error('Choose a credential JSON file smaller than 1 MB.');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Nothing was imported.'); }
  await mutate('IMPORT',{accountId:selectedId,parsed}); $('importFile').value=''; message('Keys imported for this account.');
}));
$('linkLegacy').addEventListener('click', () => action($('linkLegacy'), () => mutate('LINK_LEGACY',{accountId:$('legacyOwner').value})));
const stateEvents = new BroadcastChannel('duo-autopilot-state');
stateEvents.addEventListener('message', event => {
  if (event.data?.type === 'STATE_CHANGED') void refresh().catch(error => message(error.message,true));
});
window.addEventListener('focus', () => { if (state) void refresh().catch(error => message(error.message,true)); });
async function refresh() { state = await request('STATE'); render(); }
await refresh().catch(error => { $('globalStatus').textContent='Could not load accounts'; $('globalDetail').textContent='Reload the extension, then reopen this page.'; message(error.message,true); $('addAccount').disabled=true; });
setInterval(() => { if (state?.enrollment && state.enrollment.expiresAt <= Date.now()) void refresh().catch(error => message(error.message,true)); },1000);

}
