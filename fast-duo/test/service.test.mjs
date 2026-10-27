import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';
import { createRegistration, bytesToBase64 } from '../src/crypto.js';
function memory(initial={}) {
  let store=structuredClone(initial);
  return { async get(keys){ if(typeof keys==='string')keys=[keys];return Object.fromEntries(keys.map(k=>[k,structuredClone(store[k])]))},
    async set(data){store={...store,...structuredClone(data)}},async remove(keys){for(const k of keys)delete store[k]},raw:()=>structuredClone(store) };
}
const generated=await createRegistration({rpId:'duosecurity.com',challenge:new Uint8Array(32),origin:'https://test.duosecurity.com',signCount:0});
const fixture={rpId:'duosecurity.com',credentialId:bytesToBase64(generated.credentialId),privateKey:bytesToBase64(generated.privateKeyPkcs8),signCount:0,userHandle:btoa('user-a'),isResidentCredential:true,transport:'usb'};
const accounts=[{id:'a',username:'demo-user'},{id:'b',username:'demouser'}];
const origin='https://test.duosecurity.com';
const sender={url:origin+'/frame',tab:{id:7}};
const request={rpId:'duosecurity.com',origin,challenge:btoa('fresh-challenge'),allowCredentials:[fixture.credentialId],usernames:[]};
async function setup(initial={}){
  let time=1800000000000;const storage=memory(initial);const service=createService(storage,()=>time);
  await service.initialize({accounts,credentials:[fixture],owner:'demo-user'});
  return {service,storage,advance:ms=>time+=ms};
}
test('personal bootstrap assigns keys only to their confirmed owner and public state omits secrets',async()=>{
  const {service,storage}=await setup();const state=await service.run('STATE');
  assert.equal(state.credentials[0].accountId,'a');assert.equal(state.accounts.length,2);
  const publicJSON=JSON.stringify(state);assert.ok(!publicJSON.includes(fixture.privateKey));assert.ok(!publicJSON.includes('privateKey'));assert.ok(!publicJSON.includes('userHandle'));
  assert.equal(storage.raw().autopilotV1.credentials[0].privateKey,fixture.privateKey);
});
test('fresh public package starts empty and creates an account',async()=>{
  const service=createService(memory());await service.initialize({accounts:[]});
  assert.equal((await service.run('STATE')).credentials.length,0);
  const state=await service.run('SAVE_ACCOUNT',{username:'newuser'});assert.equal(state.accounts[0].username,'newuser');
});
test('migrates legacy credentials once and removes old secret storage',async()=>{
  const {storage,service}=await setup({duoCredentials:[fixture],settings:{enabled:false}});
  assert.equal((await service.run('STATE')).settings.enabled,false);
  assert.equal(storage.raw().duoCredentials,undefined);
  await service.initialize({accounts:[]});assert.equal((await service.run('STATE')).credentials.length,1);
});
test('removal survives initialization; packaged keys never resurrect',async()=>{
  const {service}=await setup();await service.run('REMOVE_ACCOUNT',{accountId:'a'});
  await service.initialize({accounts,credentials:[fixture],owner:'demo-user'});
  assert.equal((await service.run('STATE')).credentials.length,0);
});
test('wrong origin and mismatched claimed origin never sign',async()=>{
  const {service}=await setup();
  for(const [r,s] of [[request,{url:'https://evil.test',tab:{id:7}}],[{...request,origin:'https://other.duosecurity.com'},sender],[{...request,rpId:'evil.test'},sender]])assert.equal((await service.run('SIGN',r,s)).ok,false);
});
test('pause blocks signing and cancels enrollment',async()=>{
  const {service}=await setup();await service.run('ARM',{accountId:'a',tabId:7,tabUrl:sender.url,transport:'usb'});
  await service.run('SAVE_SETTINGS',{enabled:false});assert.equal((await service.run('STATE')).enrollment,null);
  assert.equal((await service.run('SIGN',request,sender)).ok,false);
});
test('concurrent assertions advance durable counters before returning',async()=>{
  const {service,storage}=await setup();
  const results=await Promise.all([service.run('SIGN',request,sender),service.run('SIGN',request,sender)]);
  assert.ok(results.every(r=>r.ok));
  const counters=results.map(r=>new DataView(Uint8Array.from(atob(r.authenticatorData),c=>c.charCodeAt(0)).buffer).getUint32(33));
  assert.equal(counters[1],counters[0]+1);assert.equal(storage.raw().autopilotV1.credentials[0].signCount,counters[1]);
});
test('wrong-account matching produces an actionable activity entry without signing',async()=>{
  const {service}=await setup();assert.equal((await service.run('SIGN',{...request,usernames:['demouser']},sender)).ok,false);
  assert.match((await service.run('STATE')).events[0].message,/No linked key/);
});
const enrollment={...request,username:'demouser',userHandle:btoa('user-b'),pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorAttachment:'cross-platform',residentKey:true};
const arm={accountId:'b',tabId:7,tabUrl:sender.url,transport:'usb'};
test('capture requires explicit arming and the correct tab, origin, username and timeout',async()=>{
  const {service,advance}=await setup();
  assert.equal((await service.run('ENROLL',enrollment,sender)).ok,false);
  await service.run('ARM',arm);
  assert.equal((await service.run('ENROLL',enrollment,{...sender,tab:{id:8}})).ok,false);
  assert.equal((await service.run('ENROLL',{...enrollment,origin:'https://other.duosecurity.com'},sender)).ok,false);
  assert.equal((await service.run('ENROLL',{...enrollment,username:'demo-user'},sender)).ok,false);
  assert.equal((await service.run('ENROLL',{...enrollment,pubKeyCredParams:[{alg:-257}]},sender)).ok,false);
  advance(600001);assert.equal((await service.run('ENROLL',enrollment,sender)).ok,false);
});
test('capture is one-shot, saves a pending key, then activates on an exact Duo key request',async()=>{
  const {service}=await setup();await service.run('ARM',arm);
  const result=await service.run('ENROLL',enrollment,sender);assert.equal(result.ok,true);
  let state=await service.run('STATE');assert.equal(state.enrollment,null);assert.equal(state.credentials[1].status,'pending');assert.equal(state.credentials[1].accountId,'b');
  assert.equal((await service.run('ENROLL',enrollment,sender)).ok,false);
  assert.equal((await service.run('SIGN',{...request,allowCredentials:[],usernames:['demouser']},sender)).ok,false);
  assert.equal((await service.run('SIGN',{...request,allowCredentials:[result.credentialId]},sender)).ok,true);
  state=await service.run('STATE');assert.equal(state.credentials[1].status,'ready');
});
test('concurrent enrollment calls mint only one key',async()=>{
  const {service}=await setup();await service.run('ARM',arm);
  const r=await Promise.all([service.run('ENROLL',enrollment,sender),service.run('ENROLL',enrollment,sender)]);
  assert.equal(r.filter(x=>x.ok).length,1);assert.equal((await service.run('STATE')).credentials.length,2);
});
test('confirmation and cancellation update enrollment state',async()=>{
  const {service}=await setup();await service.run('ARM',arm);const r=await service.run('ENROLL',enrollment,sender);
  await service.run('CONFIRM',{credentialId:r.credentialId});assert.equal((await service.run('STATE')).credentials[1].status,'ready');
  await service.run('ARM',arm);await service.run('CANCEL');assert.equal((await service.run('STATE')).enrollment,null);
});
test('import rejects assigning an existing key to another account',async()=>{
  const {service}=await setup();await assert.rejects(service.run('IMPORT',{accountId:'b',parsed:[fixture]}),/another account/);
  assert.equal((await service.run('STATE')).credentials[0].accountId,'a');
});
test('reimport never reduces counter; invalid imports cannot partially mutate state',async()=>{
  const {service,storage}=await setup();await service.run('SIGN',request,sender);
  const before=storage.raw().autopilotV1.credentials[0].signCount;
  await service.run('IMPORT',{accountId:'a',parsed:[fixture]});assert.ok(storage.raw().autopilotV1.credentials[0].signCount>before);
  await assert.rejects(service.run('IMPORT',{accountId:'a',parsed:[fixture,{...fixture,privateKey:''}]}));assert.equal((await service.run('STATE')).credentials.length,1);
});
test('account toggle, edits, settings and legacy linking stay isolated',async()=>{
  const {service}=await setup();await service.run('SAVE_ACCOUNT',{id:'a',username:'demo-user',label:'Work',loginUrl:'https://example.com'});
  await service.run('TOGGLE_ACCOUNT',{accountId:'a'});assert.equal((await service.run('SIGN',request,sender)).ok,false);
  await service.run('SAVE_SETTINGS',{toast:false,trustClick:true});assert.deepEqual(await service.run('SETTINGS'),{enabled:true,trustClick:true,toast:false});
  const legacy=createService(memory({duoCredentials:[fixture]}));await legacy.initialize({accounts});
  assert.equal((await legacy.run('STATE')).credentials[0].accountId,null);await legacy.run('LINK_LEGACY',{accountId:'b'});assert.equal((await legacy.run('STATE')).credentials[0].accountId,'b');
});
test('invalid stored state fails explicitly; request queue recovers after validation failure',async()=>{
  const broken=createService(memory({autopilotV1:{version:99}}));await assert.rejects(broken.initialize({}),/storage/);
  const {service}=await setup();await assert.rejects(service.run('SAVE_ACCOUNT',{username:'bad user'}));assert.equal((await service.run('STATE')).accounts.length,2);
});
test('activity is bounded and storage write failure cannot release a signature',async()=>{
  const {service}=await setup();for(let i=0;i<20;i++)await service.run('SAVE_ACCOUNT',{id:'a',username:'demo-user'});assert.equal((await service.run('STATE')).events.length,12);
  const storage=memory();const service2=createService(storage);await service2.initialize({accounts,credentials:[fixture],owner:'demo-user'});
  storage.set=async()=>{throw new Error('disk failure')};await assert.rejects(service2.run('SIGN',request,sender),/disk failure/);
});
test('failed registration reports the observed username and unconfirmed keys can be discarded',async()=>{
  const {service}=await setup();await service.run('ARM',arm);
  await service.run('ENROLL',{...enrollment,username:'demouser@example.edu'},sender);
  assert.match((await service.run('STATE')).enrollment.error,/demouser@example.edu/);
  const r=await service.run('ENROLL',enrollment,sender);
  await service.run('DISCARD_PENDING',{credentialId:r.credentialId});
  assert.equal((await service.run('STATE')).credentials.length,1);
  await assert.rejects(service.run('DISCARD_PENDING',{credentialId:fixture.credentialId}),/unconfirmed/);
});

const aliasBootstrap = { aliasMigrations: [{ id: 'fixture-alias-1', ownerUsername: 'demo-user', username: 'demouser' }] };
test('personal migration merges the placeholder once, preserving keys and counters', async () => {
  const { service, storage } = await setup();
  const before = storage.raw().autopilotV1.credentials;
  await service.initialize(aliasBootstrap);
  const state = await service.run('STATE');
  assert.equal(state.accounts.length, 1);
  assert.deepEqual(state.accounts[0].aliases, ['demouser']);
  assert.deepEqual(storage.raw().autopilotV1.credentials, before);
  await service.run('SAVE_ALIASES', { accountId: 'a', aliases: [] });
  await service.initialize(aliasBootstrap);
  assert.deepEqual((await service.run('STATE')).accounts[0].aliases, [], 'Removed aliases must not return on startup');
  await service.run('REMOVE_ACCOUNT', { accountId: 'a' });
  await service.initialize(aliasBootstrap);
  assert.equal((await service.run('STATE')).accounts.length, 0);
});

test('migration preserves keys enrolled on the old profile and cancels its capture', async () => {
  const { service, storage } = await setup();
  await service.run('ARM', arm);
  await service.run('ENROLL', enrollment, sender);
  await service.run('ARM', arm);
  const before = storage.raw().autopilotV1.credentials;
  await service.initialize(aliasBootstrap);
  const state = storage.raw().autopilotV1;
  assert.equal(state.enrollment, null);
  assert.equal(state.accounts.length, 1);
  assert.deepEqual(state.credentials, before.map(c => ({ ...c, accountId: 'a' })));
});

test('migration never recreates a removed owner and public setup has no automatic aliases', async () => {
  const { service } = await setup();
  await service.run('REMOVE_ACCOUNT', { accountId: 'a' });
  await service.initialize(aliasBootstrap);
  assert.deepEqual((await service.run('STATE')).accounts.map(a => a.username), ['demouser']);
  const clean = createService(memory());
  await clean.initialize({ accounts: [] });
  assert.equal((await clean.run('STATE')).accounts.length, 0);
});

test('migration conflict or failed save preserves the original profiles', async () => {
  const { service, storage } = await setup();
  const before = storage.raw();
  const save = storage.set;
  storage.set = async () => { throw new Error('disk full'); };
  await assert.rejects(service.initialize(aliasBootstrap), /disk full/);
  assert.deepEqual(storage.raw(), before);
  storage.set = save;
  await service.initialize(aliasBootstrap);
  assert.equal((await service.run('STATE')).accounts.length, 1);
  const other = await service.run('SAVE_ACCOUNT', { username: 'other', aliases: ['third'] });
  const prior = storage.raw();
  await assert.rejects(service.initialize({ aliasMigrations: [{ id: 'conflict', ownerUsername: 'demo-user', username: 'third' }] }), /another account/);
  assert.deepEqual(storage.raw(), prior);
  assert.equal(other.accounts.length, 2);
});

test('primary and alternate logins use the same durable key counter', async () => {
  const { service, storage } = await setup();
  await service.initialize(aliasBootstrap);
  const results = await Promise.all(['demo-user', 'demouser'].map(username => service.run('SIGN', { ...request, usernames: [username] }, sender)));
  assert.ok(results.every(r => r.ok && r.credentialId === fixture.credentialId));
  const counters = results.map(r => new DataView(Uint8Array.from(atob(r.authenticatorData), c => c.charCodeAt(0)).buffer).getUint32(33));
  assert.equal(counters[1], counters[0] + 1);
  assert.equal(storage.raw().autopilotV1.credentials.length, 1);
  assert.equal(storage.raw().autopilotV1.credentials[0].signCount, counters[1]);
  await service.run('TOGGLE_ACCOUNT', { accountId: 'a' });
  assert.equal((await service.run('SIGN', { ...request, usernames: ['demouser'] }, sender)).ok, false);
});

test('saving/removing aliases preserves keys; account edits preserve aliases', async () => {
  const { service, storage } = await setup();
  await assert.rejects(service.run('SAVE_ALIASES', { accountId: 'a', aliases: ['demouser'] }), /another account/);
  await service.run('SAVE_ALIASES', { accountId: 'a', aliases: ['other-login'] });
  await service.run('SAVE_ACCOUNT', { id: 'a', username: 'demo-user', label: 'My account' });
  assert.deepEqual((await service.run('STATE')).accounts.find(a => a.id === 'a').aliases, ['other-login']);
  const before = storage.raw().autopilotV1.credentials;
  await assert.rejects(service.run('SAVE_ALIASES', { accountId: 'a' }), /must be a list/);
  await service.run('SAVE_ALIASES', { accountId: 'a', aliases: [] });
  assert.deepEqual(storage.raw().autopilotV1.credentials, before);
  assert.equal((await service.run('SIGN', { ...request, usernames: ['other-login'] }, sender)).ok, false);
});

test('guided enrollment accepts a linked alias, but rejects unlinked usernames', async () => {
  const { service } = await setup();
  await service.initialize(aliasBootstrap);
  await service.run('ARM', { ...arm, accountId: 'a' });
  assert.equal((await service.run('ENROLL', { ...enrollment, username: 'unknown' }, sender)).ok, false);
  assert.equal((await service.run('ENROLL', enrollment, sender)).ok, true);
  assert.ok((await service.run('STATE')).credentials.every(c => c.accountId === 'a'));
});
