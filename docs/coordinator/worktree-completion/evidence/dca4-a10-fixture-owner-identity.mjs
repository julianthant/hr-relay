import {readFileSync,existsSync} from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const root="/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4";
if(process.cwd()!==root)throw new Error("Wrong workdir");
const prefix="docs/coordinator/worktree-completion/evidence/dca4-a10-fixture-owner-";
const parent=JSON.parse(readFileSync("docs/coordinator/worktree-completion/evidence/dca4-a10-parent-review-freeze.json","utf8"));
const scope=["tests/parity/helpers/fixture-run-captures.ts","tests/unit/dashboard/run-captures-fixture.test.ts","src/dashboard/AGENTS.md"];
const sha=b=>createHash("sha256").update(b).digest("hex");
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"});
const head=git("rev-parse","HEAD").trim(),index=git("diff","--cached","--name-only");
if(head!==parent.head||index!=="")throw new Error("HEAD/index mismatch");
const candidate=Object.fromEntries(Object.entries(parent.candidate).map(([p,v])=>[p,{beforeSha256:v.beforeSha256,sha256:sha(readFileSync(p)),bytes:readFileSync(p).length}]));
if(process.argv[2]==="before"&&JSON.stringify(candidate)!==JSON.stringify(parent.candidate))throw new Error("29-path candidate mismatch");
if(process.argv[2]==="patch"){
 for(const [i,p]of scope.entries()){
  const r=spawnSync("diff",["-u","-L","a/"+p,"-L","b/"+p,prefix+"before-"+i+".txt",p],{cwd:root,encoding:"utf8"});
  if(r.status!==0&&r.status!==1)throw new Error(r.stderr);
  process.stdout.write(r.stdout);
 }
}else{
 const paths=[...new Set(git("ls-files","-z","--cached","--others","--exclude-standard").split("\0").filter(Boolean))].sort();
 const groups={protected:paths.filter(p=>!scope.includes(p)&&!p.startsWith("docs/coordinator/")),
 priorCoordination:paths.filter(p=>p.startsWith("docs/coordinator/")&&!p.includes("/dca4-a10-fixture-owner-"))};
 const record={head,index,candidateDigest:sha(JSON.stringify(candidate)),candidateCount:Object.keys(candidate).length,
 scope:Object.fromEntries(scope.map((p,i)=>[p,{sha256:sha(readFileSync(p)),bytes:readFileSync(p).length,saved:prefix+"before-"+i+".txt"}])),
 ...Object.fromEntries(Object.entries(groups).flatMap(([name,ps])=>[[name+"Count",ps.length],[name+"Digest",sha(JSON.stringify(Object.fromEntries(ps.map(p=>[p,existsSync(p)?sha(readFileSync(p)):null]))))]]))};
 if(process.argv[2]==="after"){
  const before=JSON.parse(readFileSync(prefix+"before.json","utf8"));
  if(record.protectedDigest!==before.protectedDigest||record.protectedCount!==before.protectedCount)throw new Error("Protected files changed");
  record.priorCoordinationMatches = record.priorCoordinationDigest===before.priorCoordinationDigest && record.priorCoordinationCount===before.priorCoordinationCount;
 }
 console.log(JSON.stringify(record,null,2));
}
