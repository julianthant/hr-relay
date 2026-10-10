import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const statuses = ["done", "now", "next", "later"] as const;
type Status = typeof statuses[number];
interface Item { status: Status; name: string; description?: string }
interface Section { title: string; intro: string; items: Item[] }
interface Roadmap { title: string; intro: string; sections: Section[] }

export function parseRoadmap(text: string): Roadmap {
  const roadmap: Roadmap = { title: "", intro: "", sections: [] };
  let section: Section | undefined;
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    const fail = (message: string): never => { throw new Error(`Line ${index + 1}: ${message}`); };
    if (!line) continue;
    const title = /^# (\S.*)$/u.exec(line);
    if (title) {
      if (roadmap.title || section) fail("unexpected title");
      roadmap.title = title[1]!;
      continue;
    }
    if (!roadmap.title) fail("expected a # title");
    const heading = /^## (\S.*)$/u.exec(line);
    if (heading) {
      section = { title: heading[1], intro: "", items: [] };
      roadmap.sections.push(section);
      continue;
    }
    const item = /^- \[([^\]]+)\] (\S.*)$/u.exec(line);
    if (item) {
      if (!section) fail("item outside a section");
      const status = statuses.find((value) => value === item[1]);
      if (!status) fail(`unknown status "${item[1]}"`);
      const content = item[2];
      if (content.endsWith(" —")) fail("malformed item");
      const separator = content.indexOf(" — ");
      const name = (separator < 0 ? content : content.slice(0, separator)).trim();
      const description = separator < 0 ? undefined : content.slice(separator + 3).trim();
      if (!name || description === "") fail("malformed item");
      section!.items.push({ status: status!, name, ...(description === undefined ? {} : { description }) });
      continue;
    }
    if (/^(?:#|[-*+]|\d+[.)])/u.test(line)) fail("malformed heading or item");
    if (section?.items.length) fail("intro text must precede items");
    const target = section ?? roadmap;
    target.intro += `${target.intro ? "\n" : ""}${line}`;
  }
  if (!roadmap.title) throw new Error("Line 1: expected a # title");
  return roadmap;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function renderRoadmap(roadmap: Roadmap): string {
  const intro = (text: string): string => text ? `<p class="intro">${escapeHtml(text)}</p>` : "";
  const sections = roadmap.sections.map((section) => {
    const counts = statuses.map((status) =>
      `<span class="count ${status}">${status} <strong>${section.items.filter((item) => item.status === status).length}</strong></span>`,
    ).join("\n");
    const items = section.items.map((item) => `<li>
<span class="pill ${item.status}">${item.status}</span>
<div><strong class="name">${escapeHtml(item.name)}</strong>${item.description === undefined ? "" : `<p class="description">${escapeHtml(item.description)}</p>`}</div>
</li>`).join("\n");
    return `<section>
<h2>${escapeHtml(section.title)}</h2>
${intro(section.intro)}
<div class="counts" aria-label="Status counts">${counts}</div>
<ul>${items}</ul>
</section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(roadmap.title)}</title>
<style>
:root {
  color-scheme: light dark;
  --page: #fafaf9; --text: #252525; --muted: #606060; --line: #dededb;
  --done: #216642; --done-bg: #e3f1e9;
  --now: #215caa; --now-bg: #e4edfb;
  --next: #80560e; --next-bg: #f9efda;
  --later: #6f488d; --later-bg: #f0e7f7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #191a1b; --text: #ededeb; --muted: #b3b4b1; --line: #383a3b;
    --done: #a0d9b8; --done-bg: #203a2b;
    --now: #a8ccff; --now-bg: #20344f;
    --next: #edd095; --next-bg: #41351e;
    --later: #d6b8ee; --later-bg: #392a45;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--text); font: 16px/1.6 system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 64px 28px 80px; }
h1 { margin: 0 0 16px; font-size: clamp(2rem, 5vw, 2.75rem); line-height: 1.15; letter-spacing: -.025em; }
h2 { margin: 0 0 12px; font-size: 1.5rem; line-height: 1.3; letter-spacing: -.015em; }
section { margin-top: 56px; }
p { margin: 0; }
.intro { max-width: 72ch; color: var(--muted); white-space: pre-line; }
.counts { display: flex; flex-wrap: wrap; gap: 10px 24px; margin: 22px 0 14px; font-size: .875rem; }
.count strong { margin-left: 5px; font-variant-numeric: tabular-nums; }
ul { list-style: none; padding: 0; margin: 0; border-top: 1px solid var(--line); }
li { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 18px; padding: 20px 0; border-bottom: 1px solid var(--line); }
.pill { align-self: start; text-align: center; border-radius: 5px; padding: 3px 8px; font-size: .75rem; font-weight: 650; line-height: 1.5; }
.done { color: var(--done); } .now { color: var(--now); }
.next { color: var(--next); } .later { color: var(--later); }
.pill.done { background: var(--done-bg); } .pill.now { background: var(--now-bg); }
.pill.next { background: var(--next-bg); } .pill.later { background: var(--later-bg); }
.name { font-weight: 600; } .description { margin-top: 4px; color: var(--muted); max-width: 72ch; }
li div, .intro { overflow-wrap: anywhere; }
@media (max-width: 480px) { main { padding: 36px 20px 56px; } li { gap: 12px; } }
</style>
</head>
<body>
<main>
<header><h1>${escapeHtml(roadmap.title)}</h1>${intro(roadmap.intro)}</header>
${sections}
</main>
</body>
</html>
`;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = new URL("../../docs/roadmap/roadmap.md", import.meta.url);
  const output = new URL("../../docs/roadmap/index.html", import.meta.url);
  const html = renderRoadmap(parseRoadmap(readFileSync(source, "utf8")));
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== html) throw new Error("Roadmap index is stale; run npm run roadmap");
  } else {
    mkdirSync(dirname(fileURLToPath(output)), { recursive: true });
    writeFileSync(output, html);
  }
}
