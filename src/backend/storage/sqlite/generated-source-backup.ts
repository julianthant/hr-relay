/** Narrow stopped-conversion capability. The caller must supply a verified native backup. */
export interface GeneratedSourceBackup {
 readonly backupPath:string;
 readonly manifestPath:string;
 readonly manifest:Readonly<{sha256:string;sourceDatabaseIdentity:string;authorityGeneration:number}>;
}
