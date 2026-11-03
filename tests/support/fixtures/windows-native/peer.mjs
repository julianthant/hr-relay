import process from "node:process";
import { closeSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const [action, path] = process.argv.slice(2);
if (action === "hold") {
  const fd = openSync(path, "r+");
  process.send({ kind: "held" });
  process.once("message", () => {
    closeSync(fd);
    process.disconnect();
  });
} else {
  try {
    if (action === "read") readFileSync(path);
    else if (action === "write") writeFileSync(path, "peer-write");
    else if (action === "companion") writeFileSync(`${path}-wal`, "late-companion");
    else if (action === "replace") { renameSync(path, `${path}-displaced`); writeFileSync(path, "replacement"); }
    else if (action === "ads") writeFileSync(`${path}:late`, "late-stream");
    else throw new Error("unknown-peer-action");
    process.stdout.write(JSON.stringify({ ok: true }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error.code }));
  }
}
