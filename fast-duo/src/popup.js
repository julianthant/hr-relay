const initial = await chrome.runtime.sendMessage({ type: 'STATE' });
if (initial?.success && initial.result?.relaySetup === true) {
  document.getElementById('status').textContent = 'Relay Duo setup';
  document.getElementById('detail').textContent = 'Setup belongs to your private Relay draft. Finish both methods in Duo.';
  document.getElementById('manage').textContent = 'Show setup';
  document.getElementById('manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('toggle').hidden = true;
} else if (chrome.runtime.getManifest().background.service_worker === 'src/relay-background.js') {
  document.getElementById('status').textContent = 'Setup unavailable';
  document.getElementById('detail').textContent = 'Return to Relay to check the original draft.';
  document.getElementById('toggle').hidden = true;
  document.getElementById('manage').disabled = true;
} else {
let state;
async function render() {
  const reply = await chrome.runtime.sendMessage({type:'STATE'});
  if (!reply?.success) throw new Error(reply?.error || 'Reload the extension.');
  state = reply.result;
  document.getElementById('status').textContent = state.settings.enabled ? 'Autopilot is on' : 'Autopilot is paused';
  document.getElementById('detail').textContent = state.settings.enabled ? 'Ready for matching Duo requests.' : 'Your keys stay saved in this browser.';
  const list = document.getElementById('popupAccounts'); list.replaceChildren();
  for (const account of state.accounts) {
    const item=document.createElement('li'); const name=document.createElement('span'); const badge=document.createElement('span');
    name.textContent=[account.username, ...(account.aliases || [])].join(' / ');
    const ready=state.credentials.some(c=>c.accountId===account.id && c.status==='ready');
    badge.textContent=!account.enabled?'Paused':ready?'Connected':'Needs setup'; badge.className='badge'+(ready&&account.enabled?' ready':'');
    item.append(name,badge);list.append(item);
  }
  document.getElementById('toggle').textContent=state.settings.enabled?'Pause Autopilot':'Resume Autopilot';
  document.getElementById('toggle').disabled=false;
}
document.getElementById('manage').addEventListener('click',()=>chrome.runtime.openOptionsPage());
document.getElementById('toggle').addEventListener('click',async()=>{
  const button=document.getElementById('toggle');button.disabled=true;
  try{const reply=await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',data:{enabled:!state.settings.enabled}});if(!reply?.success)throw new Error(reply?.error || 'Could not save.');await render();}
  catch(error){document.getElementById('error').textContent=error.message;}finally{button.disabled=false;}
});
await render().catch(error=>document.getElementById('error').textContent=error.message);

}
