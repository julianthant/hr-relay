import type { AuthorityDatabase, AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";

export function replaceOcrCommandRead(repositories: AuthorityRepositories, commandId: string,
  command: ReturnType<AuthorityRepositories["commands"]["get"]>): AuthorityRepositories {
  return { ...repositories, commands: { ...repositories.commands,
    get: id => id === commandId ? command : repositories.commands.get(id) } };
}
export function replaceOcrAuditRead(repositories: AuthorityRepositories, commandId: string,
  audit: ReturnType<AuthorityRepositories["commandAudits"]["findByCommand"]>): AuthorityRepositories {
  return { ...repositories, commandAudits: { ...repositories.commandAudits,
    findByCommand: id => id === commandId ? audit : repositories.commandAudits.findByCommand(id) } };
}
export function ocrProofReadDatabase(database: AuthorityDatabase, repositories: AuthorityRepositories): AuthorityDatabase {
  return new Proxy(database, { get(target, key) {
    if (key === "authority") return repositories;
    if (key === "withAuthorityReadSnapshot") return target.withAuthorityReadSnapshot.bind(target);
    if (key === "withAuthorityTransaction") return target.withAuthorityTransaction.bind(target);
    const value: unknown = Reflect.get(target, key, target);
    return value;
  } });
}
