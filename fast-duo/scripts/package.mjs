import { mkdir, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../',import.meta.url));
const target = resolve(process.argv[2] || join(root,'dist/duo-autopilot'));
if (target === root || !target.startsWith(join(root,'dist')+'/')) throw new Error('Package output must be a child of this project’s dist folder.');
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
// Explicit allowlist: adding a private file elsewhere cannot silently publish it.
const files=['manifest.json','src/background.js','src/private-storage.js','src/accounts.js','src/service.js','src/crypto.js','src/sign-count.js','src/username.js','src/content.js','src/inpage.js','src/options.html','src/options.js','src/popup.html','src/popup.js','src/styles.css','src/icons/autopilot.svg','src/icons/plus.svg','src/icons/key-round.svg','src/icons/shield-check.svg','LICENSE','THIRD_PARTY_NOTICES.md',... [16,32,48,128].map(n=>`src/icons/autopilot-${n}.png`)];
for(const file of files){await mkdir(resolve(target,file,'..'),{recursive:true});await copyFile(join(root,file),join(target,file));}
await writeFile(join(target,'bootstrap.json'),JSON.stringify({accounts:[],credentialFile:null},null,2)+'\n');
await copyFile(join(root,'INSTALL.md'),join(target,'README.md'));
const archive=join(root,'dist/duo-autopilot-share.zip');
await rm(archive,{force:true});
execFileSync('/usr/bin/zip',['-qr',archive,'.'],{cwd:target});
const entries=execFileSync('/usr/bin/unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n').filter(x=>!x.endsWith('/'));
const allowed=new Set([...files,'bootstrap.json','README.md']);
if(entries.length!==allowed.size || entries.some(x=>!allowed.has(x)))throw new Error('Share archive contains unexpected files.');
const bootstrap=JSON.parse(await readFile(join(target,'bootstrap.json'),'utf8'));
if(bootstrap.credentialFile || bootstrap.accounts.length)throw new Error('Share archive contains personal bootstrap data.');
console.log(`Verified ${entries.length} public files. No personal bootstrap, credentials, profiles, or test artifacts included.\n${archive}`);
