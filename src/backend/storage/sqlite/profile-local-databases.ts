import { lstatSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
export function countUcsdLoginRows(path: string): number | "unreadable" | "absent" {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info === undefined) return "absent";
  if (!info.isFile()) return "unreadable";
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const rows = z.array(z.object({
      origin_url: z.string().optional(),
      username_value: z.string().optional(),
    })).parse(database.prepare("SELECT origin_url, username_value FROM logins").all());
    return rows.filter((row) => isUcsdIdentity(row.origin_url) || isUcsdIdentity(row.username_value)).length;
  } catch {
    return "unreadable";
  } finally {
    database?.close();
  }
}

function isUcsdIdentity(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "ucsd.edu" || host.endsWith(".ucsd.edu");
  } catch {
    const text = value.toLowerCase();
    return text.endsWith("@ucsd.edu") || text.endsWith(".ucsd.edu");
  }
}
