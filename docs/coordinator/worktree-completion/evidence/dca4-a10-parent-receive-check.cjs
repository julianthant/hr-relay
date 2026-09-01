const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = '/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4';
assert.equal(process.cwd(), root);
const dir = 'docs/coordinator/worktree-completion/evidence/';
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const read = p => fs.readFileSync(p);
const json = p => JSON.parse(read(dir+p));
const git = args => cp.execFileSync('git', args, {cwd:root, encoding:'utf8'});
const head = git(['rev-parse','HEAD']).trim();
assert.equal(head,'eda17b2708286e36542e1e18e9f8ef6a06cf3187');
assert.equal(git(['diff','--cached','--name-only']), '');
git(['diff','--check']);
const before = json('dca4-a10-accounting-before.json');
const after = json('dca4-a10-accounting-final-freeze.json');
for (const [path,pin] of Object.entries({...after.scope,...after.namedPins})) {
  const bytes=read(path); assert.equal(hash(bytes),pin.sha256,path); assert.equal(bytes.length,pin.bytes,path);
}
const paths = [...new Set(git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean))].sort();
const protectedMap={};
for(const p of paths) if(!p.startsWith('docs/coordinator/') && !(p in before.scope)) protectedMap[p]=fs.existsSync(p)?hash(read(p)):null;
assert.equal(Object.keys(protectedMap).length,1861);
assert.equal(hash(JSON.stringify(protectedMap)),before.protectedDigest);
assert.equal(before.protectedDigest,after.protectedDigest);
const patch=dir+'dca4-a10-accounting-final-delta.patch';
assert.equal(hash(read(patch)),'34a4c445981d2ee9f6dc4ad921a30ea7ef892c70a9cb9e66481efa021141b323');
git(['apply','--reverse','--check',patch]);
const ledger=json('dca4-a10-accounting-evidence-index.json');
for(const g of ledger.gates) {const bytes=read(g.log);assert.equal(hash(bytes),g.rawSha256,g.name);assert.equal(bytes.length,g.rawBytes,g.name);assert.equal(g.workdir,root);}
const originals={...json('dca4-a10-authority-before.json').original};
for(const filename of ['dca4-a10-receipt-before.json','dca4-a10-accounting-before.json']) {
 for(const [p,pin] of Object.entries(json(filename).scope)) {
  if(pin!==null) {assert.equal(hash(read(pin.saved)),pin.sha256,p);assert.equal(read(pin.saved).length,pin.bytes,p);}
  if(!(p in originals)) originals[p]=pin===null?null:read(pin.saved).toString('utf8');
 }
}
const candidate={};
for(const p of Object.keys(originals).sort()) {const bytes=read(p);candidate[p]={beforeSha256:originals[p]===null?null:hash(originals[p]),sha256:hash(bytes),bytes:bytes.length};}
const intake=json('dca4-a10-authority-before.json');
const protectedA10={};
for(const p of paths) if(!p.startsWith('docs/coordinator/') && !(p in candidate)) {
 const now=fs.existsSync(p)?hash(read(p)):null; assert.equal(now,intake.hashes[p],p); protectedA10[p]=now;
}
if(process.argv[2]==='patch') {
 for(const [p,bytes] of Object.entries(originals)) {
  const d=cp.spawnSync('/usr/bin/diff',['-u','--label','a/'+p,'--label','b/'+p,bytes===null?'/dev/null':'/dev/stdin',p],{input:bytes??'',encoding:'utf8',cwd:root,maxBuffer:2000000});
  assert.ok(d.status===0||d.status===1,d.stderr);process.stdout.write(d.stdout);
 }
} else {
 console.log(JSON.stringify({head,branch:git(['branch','--show-current']).trim(),index:'',accounting:{paths:9,protectedCount:1861,protectedDigest:before.protectedDigest,rawLogsVerified:ledger.gates.length,patchSha256:hash(read(patch))},candidate,candidateDigest:hash(JSON.stringify(candidate)),protectedCount:Object.keys(protectedA10).length,protectedDigest:hash(JSON.stringify(protectedA10)),patchSequence:['dca4-a10-authority-delta.patch','dca4-a10-receipt-delta.patch','dca4-a10-accounting-final-delta.patch'].map(p=>({path:dir+p,sha256:hash(read(dir+p))})),logs:ledger.gates.map(g=>({name:g.name,exit:g.exit,sessions:g.sessions,counts:g.counts,rawSha256:g.rawSha256})),status:git(['status','--short','--untracked-files=all']).split('\n').filter(l=>l&&!l.slice(3).startsWith('docs/coordinator/'))},null,2));
}
