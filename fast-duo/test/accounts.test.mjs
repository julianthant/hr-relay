import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectCredential, validateAccount, isDuoOrigin, validateCredentials } from '../src/accounts.js';
const accounts=[{id:'a',username:'demo-user',enabled:true},{id:'b',username:'demouser',enabled:true}];
const a={accountId:'a',credentialId:btoa('alpha'),rpId:'duosecurity.com',status:'ready',transport:'internal',isResidentCredential:true,userHandle:btoa('a')};
const b={...a,accountId:'b',credentialId:btoa('beta'),transport:'usb',userHandle:btoa('b')};
const state={accounts,credentials:[a,b]};
const req={rpId:'duosecurity.com',allowCredentials:[b.credentialId],usernames:[]};
test('server key IDs select the correct account without a username',()=>assert.equal(selectCredential(state,req).credential,b));
test('similar usernames match exactly; no substring confusion',()=>assert.equal(selectCredential(state,{...req,allowCredentials:[],usernames:[' DEMOUSER ']}).credential,b));
test('a username cannot override Duo’s credential allowlist',()=>assert.match(selectCredential(state,{...req,usernames:['demo-user']}).reason,/No linked key/));
test('unknown username, unknown key and conflicting usernames all defer',()=>{
  for(const r of [{...req,usernames:['someone']},{...req,allowCredentials:[btoa('other')]},{...req,usernames:['demouser','demo-user']}])assert.ok(selectCredential(state,r).reason);
});
test('empty allowlist without a username never picks the first stored key',()=>assert.ok(selectCredential(state,{...req,allowCredentials:[]}).reason));
test('discoverable authentication requires a resident credential and user handle',()=>{
  for(const patch of [{isResidentCredential:false},{userHandle:null},{status:'pending'}])assert.ok(selectCredential({...state,credentials:[{...b,...patch}]},{...req,allowCredentials:[],usernames:['demouser']}).reason);
});
test('paused account cannot sign even with the correct requested key',()=>assert.ok(selectCredential({...state,accounts:accounts.map(x=>({...x,enabled:false}))},req).reason));
test('keys from multiple accounts in the allowlist require disambiguation',()=>assert.ok(selectCredential(state,{...req,allowCredentials:[a.credentialId,b.credentialId]}).reason));
test('pending enrollment can be activated by a server request for that exact ID',()=>assert.equal(selectCredential({...state,credentials:[{...b,status:'pending'}]},req).credential.status,'pending'));
test('usernames and sign-in links validate strictly',()=>{
  assert.equal(validateAccount({username:' DEMOUSER '}).username,'demouser');
  for(const input of [{username:'demouser'},{username:'bad user'},{username:'x',loginUrl:'http://example.com'},{username:'x',loginUrl:'https://user:secret@example.com'}])assert.throws(()=>validateAccount(input,accounts));
});
test('Duo origin must be HTTPS with the exact domain suffix',()=>{
  for(const value of ['https://api-1.duosecurity.com/frame','https://duosecurity.com/'])assert.equal(isDuoOrigin(value),true);
  for(const value of ['http://api.duosecurity.com/','https://duosecurity.com.evil.test/','https://evilduosecurity.com/','https://user@duosecurity.com/','garbage'])assert.equal(isDuoOrigin(value),false);
});
test('imports reject partial invalid or duplicate sets',()=>{
  const c={...a,privateKey:btoa('key'),signCount:0};
  assert.equal(validateCredentials([c]).length,1);
  for(const input of [[c,{...c,privateKey:''}],[c,c],[],[{...c,signCount:-1}]])assert.throws(()=>validateCredentials(input));
});
test('manifest keeps both content worlds and host access scoped to Duo', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['https://*.duosecurity.com/*']);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.content_scripts.map(script => script.world), ['MAIN', 'ISOLATED']);
  for (const script of manifest.content_scripts) assert.deepEqual(script.matches, ['https://*.duosecurity.com/*']);
});

test('alternate usernames normalize, deduplicate, and cannot overlap another account', () => {
  const owner = validateAccount({ id: 'a', username: 'demo-user', aliases: [' DEMOUSER ', 'demouser', 'DEMO-USER'] });
  assert.deepEqual(owner.aliases, ['demouser']);
  for (const input of [
    { username: 'demouser' }, { username: 'other', aliases: ['demouser'] },
    { username: 'other', aliases: ['demo-user'] }, { username: 'other', aliases: ['bad username'] },
    { username: 'other', aliases: 'demouser' }, { username: 'other', aliases: Array.from({ length: 21 }, (_, i) => 'user' + i) },
  ]) assert.throws(() => validateAccount(input, [owner]));
});

test('an alias and primary username share the same key without overriding the server', () => {
  const linked = { ...state, accounts: [{ ...accounts[0], aliases: ['demouser'] }] };
  for (const usernames of [['demo-user'], [' DEMOUSER '], ['demo-user', 'demouser']]) {
    assert.equal(selectCredential(linked, { ...req, usernames, allowCredentials: [a.credentialId] }).credential, a);
    assert.equal(selectCredential(linked, { ...req, usernames, allowCredentials: [] }).credential, a);
    assert.ok(selectCredential(linked, { ...req, usernames, allowCredentials: [b.credentialId] }).reason);
  }
  assert.ok(selectCredential(linked, { ...req, usernames: ['demouser', 'unknown'] }).reason);
  assert.ok(selectCredential(linked, { ...req, usernames: ['demou'] }).reason);
});

test('paused aliases and corrupt duplicate ownership never select a key', () => {
  const linked = { ...state, accounts: [{ ...accounts[0], aliases: ['demouser'], enabled: false }] };
  assert.ok(selectCredential(linked, { ...req, usernames: ['demouser'], allowCredentials: [a.credentialId] }).reason);
  linked.accounts = [{ ...accounts[0], aliases: ['demouser'] }, accounts[1]];
  assert.ok(selectCredential(linked, { ...req, usernames: ['demouser'], allowCredentials: [a.credentialId] }).reason);
});
