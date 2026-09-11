import { requireSupportedRecoverySchema } from "./recovery-admission.js";
import type { VersionChange } from "../../domain/archive/change-record.js";
import { z } from "zod";
import type { AuthorityDatabase } from "./authority-database.js";
import type { ArchiveReport } from "../../domain/archive/report.js";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";

export { LifecycleSourceSnapshotSchema, lifecycleSourceDigest, type LifecycleSourceSnapshot } from "../../domain/archive/lifecycle-source.js";

/** The common lifecycle port: A owns capture policy; Q owns derivation and query policy. */
export function createRunLifecycleStorage(database: AuthorityDatabase) {
  return Object.freeze({
    claimVersionChange: (input: Parameters<AuthorityDatabase["claimVersionChange"]>[0]) => database.claimVersionChange(input),
    replaceVersionChange: (priorId:string,fingerprint:string,replacement:VersionChange) => database.replaceVersionChange(priorId,fingerprint,replacement),
    historicalArchiveSource: () => database.historicalArchiveSource(),
    historicalVersionChanges: () => database.historicalVersionChanges(),
    readPendingReport: (runId:string,transferId:string) => database.readPendingArchiveReport(runId,transferId),
    archiveWorkflows: () => database.archiveWorkflows(),
    listReports: (query: import("../../domain/archive/report.js").ArchiveQuery) => database.queryArchiveReports(query),
    readVersionChange: (id: string) => database.readVersionChange(id),
    writeVersionChange: (change: VersionChange) => database.writeVersionChange(change),
    capture: (runId: string) => database.captureLifecycleSource(runId),
    refreshSummaries: () => database.refreshRunSummaries(),
    summaries: () => database.readRunSummaries(),
    summaryWorkflows: () => database.summaryWorkflows(),
    querySummaries: (query: Parameters<AuthorityDatabase["queryRunSummaries"]>[0]) => database.queryRunSummaries(query),
    transfer: (input: {runId: string; digest: string; expectedVersion: number}) => database.transferLifecycleSources(input),
    publishReport: (runId: string, digest: string) => database.publishTransferredReport(runId,digest),
    reportOwner: (runId: string) => database.savedReportOwner(runId),
    readReport: (runId: string) => {
      const identity = database.savedReportOwner(runId);
      return identity.state !== "archived" ? undefined : database.lifecycleArchive(true).readPublishedReport(runId);
    },
    readSourceFile: (file: ArchiveReport["content"]["files"][number]) => database.readLifecycleSourceFile(file),
    retainFile: (file: ArchiveReport["content"]["files"][number], bytes: Uint8Array) => database.lifecycleArchive().retainFile(file,bytes),
    readFile: (runId: string, digest: string) => {
      const identity = database.savedReportOwner(runId);
      if (identity.state !== "archived") throw new Error("archive-download-owner-missing");
      const report = database.lifecycleArchive(true).verifiedReport(runId,identity.reportDigest);
      const file = report.content.files.find(candidate => candidate.digest === digest);
      if (file === undefined) throw new Error("archive-download-membership-missing");
      return {file, bytes:database.lifecycleArchive(true).readFile(file)};
    },
    saveReport: (report: ArchiveReport) => database.lifecycleArchive().capture(report),
    verifyReport: (runId: string, digest: string) => database.lifecycleArchive().verify(runId, digest),
  });
}

import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Clock } from "../../domain/clock.js";
import { ArchiveDatabase } from "./archive-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "./backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreOptionsSchema, OfflineRestoreFailure } from "./offline-restore.js";
import { OfflineRestoreRequestSchema } from "./recovery-contracts.js";
import { acquireRuntimeRestoreAdmission, observeRuntimeLockSnapshot } from "./runtime-process-locks.js";

const SafeName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u).refine(name=>name!==".." && name!==".");
const PairManifestSchema = z.strictObject({
  schemaVersion:z.literal(1), sourceDatabaseIdentity:z.string().min(1), liveManifest:SafeName,
  liveManifestDigest:z.string().regex(/^[a-f0-9]{64}$/u), archiveFile:SafeName,
  archiveDigest:z.string().regex(/^[a-f0-9]{64}$/u), archiveFingerprint:z.string().regex(/^[a-f0-9]{64}$/u),
  fileDirectory:SafeName, files:z.array(z.strictObject({digest:z.string().regex(/^[a-f0-9]{64}$/u),byteLength:z.number().int().nonnegative(),name:z.string(),mediaType:z.string(),artifactIds:z.array(z.string().uuid()).optional()})),
});
function durableDirectory(path:string) { const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);} }
function safeBytes(path:string) {
  if(!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())throw new Error("lifecycle-recovery-file-invalid");
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{return readFileSync(fd);}finally{closeSync(fd);}
}
function fileDigest(path:string){return createHash("sha256").update(safeBytes(path)).digest("hex");}

/** Pair publication is last: mutation during either native snapshot refuses the whole set. */
export async function backupLifecyclePair(source: ConstructorParameters<typeof AuthorityBackupService>[0], stateRoot:string,clock:Clock) {
  const archivePath=join(stateRoot,"archive.sqlite"),directory=join(stateRoot,"backups","authority");
  const archive=existsSync(archivePath)?new ArchiveDatabase(archivePath,{readOnly:true}):undefined;
  try {
    const generation=source.getMeta().authorityGeneration, fingerprint=archive?.fingerprint();
    const report=await new AuthorityBackupService(source,{directory},clock).request({trigger:"operator",requiredGeneration:generation});
    if(archive===undefined){if(existsSync(archivePath))throw new Error("lifecycle-backup-source-changed");return report;}
    const manifest=report.manifests.at(-1);if(manifest===undefined)throw new Error("lifecycle-backup-live-missing");
    const token=randomUUID(),archiveFile=`${token}.archive.sqlite`,fileDirectory=`${token}.archive-files`;
    await archive.onlineBackupTo(join(directory,archiveFile));
    const copy=new ArchiveDatabase(join(directory,archiveFile),{readOnly:true});
    try{if(copy.fingerprint()!==fingerprint)throw new Error("lifecycle-backup-archive-changed");}finally{copy.close();}
    const files=archive.files();mkdirSync(join(directory,fileDirectory),{mode:0o700});
    for(const file of files)writeFileSync(join(directory,fileDirectory,file.digest),archive.readFile(file),{flag:"wx",mode:0o600,flush:true});
    durableDirectory(join(directory,fileDirectory));
    if(source.getMeta().authorityGeneration!==generation || manifest.authorityGeneration!==generation || archive.fingerprint()!==fingerprint)throw new Error("lifecycle-backup-source-changed");
    const liveManifest=`${manifest.backupFileName}.manifest.json`;
    const pair=PairManifestSchema.parse({schemaVersion:1,sourceDatabaseIdentity:source.getSourceDatabaseIdentity(),liveManifest,
      liveManifestDigest:fileDigest(join(directory,liveManifest)),archiveFile,archiveDigest:fileDigest(join(directory,archiveFile)),
      archiveFingerprint:fingerprint,fileDirectory,files});
    const pairedManifestPath=join(directory,`${liveManifest}.lifecycle.json`);
    writeFileSync(pairedManifestPath,canonicalJsonStringify(pair),{flag:"wx",mode:0o600,flush:true});durableDirectory(directory);
    await verifyLifecyclePair(pairedManifestPath);
    return {...report,pairedManifestPath};
  }finally{archive?.close();}
}

export async function verifyLifecyclePair(path:string) {
  const pair=PairManifestSchema.parse(JSON.parse(safeBytes(path).toString("utf8"))),root=dirname(path);
  const liveManifestPath=join(root,pair.liveManifest);
  if(fileDigest(liveManifestPath)!==pair.liveManifestDigest || fileDigest(join(root,pair.archiveFile))!==pair.archiveDigest)throw new Error("lifecycle-backup-digest-mismatch");
  const live=await verifyBackupManifestAtPath(liveManifestPath,pair.sourceDatabaseIdentity);
  const archive=new ArchiveDatabase(join(root,pair.archiveFile),{readOnly:true});
  try{if(archive.fingerprint()!==pair.archiveFingerprint)throw new Error("lifecycle-backup-archive-mismatch");}finally{archive.close();}
  for(const file of pair.files){const bytes=safeBytes(join(root,pair.fileDirectory,file.digest));if(bytes.length!==file.byteLength||createHash("sha256").update(bytes).digest("hex")!==file.digest)throw new Error("lifecycle-backup-file-mismatch");}
  return {pair,live,root};
}

/** One stopped admission covers both stores. A durable marker refuses runtime boot after any interruption. */
export async function restoreLifecyclePair(optionsInput:z.input<typeof OfflineRestoreOptionsSchema>, requestInput:z.input<typeof OfflineRestoreRequestSchema>,
  rebuild:(path:string)=>Promise<void>,clock:Clock,afterStep?:(step:"live"|"archive"|"files")=>void) {
  const options=OfflineRestoreOptionsSchema.parse(optionsInput),request=OfflineRestoreRequestSchema.parse(requestInput);
  const verified=await verifyLifecyclePair(request.manifestPath),stateRoot=dirname(options.authorityPath);
  requireSupportedRecoverySchema(verified.live.manifest.schemaVersion);
  const {AuthorityDatabase:LiveDatabase}=await import("./authority-database.js");
  if(verified.pair.sourceDatabaseIdentity!==LiveDatabase.sourceDatabaseIdentity(options.authorityPath))throw new Error("lifecycle-restore-identity-mismatch");
  const admission=acquireRuntimeRestoreAdmission({processLockRoot:options.processLockRoot,pid:process.pid},clock);
  const journal=join(stateRoot,".lifecycle-restore.json"),identity=canonicalJsonStringify({schemaVersion:1,manifestDigest:fileDigest(request.manifestPath)});
  let changed=false;
  let createdJournal=false;
  try {
    const observation=observeRuntimeLockSnapshot({processLockRoot:options.processLockRoot,sourceDatabaseIdentity:verified.pair.sourceDatabaseIdentity},clock);
    if(Object.values(observation.processLocks).some(lock=>lock.state === "active"))throw new Error("lifecycle-restore-runtime-active");
    if(existsSync(journal)){if(safeBytes(journal).toString("utf8")!==identity)throw new Error("lifecycle-restore-resume-mismatch");}
    else {writeFileSync(journal,identity,{flag:"wx",mode:0o600,flush:true});durableDirectory(stateRoot);createdJournal=true;}
    const report=await new OfflineAuthorityRestoreService(options,rebuild,clock,undefined,()=>({...admission,release(){}}))
      .restore({...request,manifestPath:verified.live.manifestPath});
    changed=true;afterStep?.("live");
    const token=randomUUID(),archivePath=join(stateRoot,"archive.sqlite"),staged=`${archivePath}.${token}.restore`;
    writeFileSync(staged,safeBytes(join(verified.root,verified.pair.archiveFile)),{flag:"wx",mode:0o600,flush:true});
    mkdirSync(options.suspectDirectory,{recursive:true,mode:0o700});
    for(const suffix of ["","-wal","-shm"]){const old=`${archivePath}${suffix}`;if(existsSync(old)){if(lstatSync(old).isSymbolicLink())throw new Error("lifecycle-restore-symlink");renameSync(old,join(options.suspectDirectory,`archive.${token}${suffix}`));}}
    renameSync(staged,archivePath);durableDirectory(stateRoot);afterStep?.("archive");
    const fileRoot=join(stateRoot,"archive-files"),stagedFiles=join(stateRoot,`archive-files.${token}.restore`);
    mkdirSync(stagedFiles,{mode:0o700});
    for(const file of verified.pair.files)writeFileSync(join(stagedFiles,file.digest),safeBytes(join(verified.root,verified.pair.fileDirectory,file.digest)),{flag:"wx",mode:0o600,flush:true});
    durableDirectory(stagedFiles);
    if(existsSync(fileRoot)){if(lstatSync(fileRoot).isSymbolicLink())throw new Error("lifecycle-restore-symlink");renameSync(fileRoot,join(options.suspectDirectory,`archive-files.${token}`));}
    renameSync(stagedFiles,fileRoot);durableDirectory(stateRoot);afterStep?.("files");
    const archive=new ArchiveDatabase(archivePath,{readOnly:true});try{if(archive.fingerprint()!==verified.pair.archiveFingerprint)throw new Error("lifecycle-restore-archive-mismatch");archive.files();}finally{archive.close();}
    unlinkSync(journal);durableDirectory(stateRoot);return report;
  }catch(error){
    if(createdJournal && !changed && error instanceof OfflineRestoreFailure && error.authorityState === "unchanged") {unlinkSync(journal);durableDirectory(stateRoot);throw error;}
    throw new OfflineRestoreFailure(changed?"replaced":"authority-state-uncertain","lifecycle-restore-incomplete; runtime remains blocked until paired settlement",error);}
  finally{admission.release();}
}
