"""Temporary #810 evidence runner. Run on the Linux Actions lint job."""
from collections import defaultdict
from contextlib import ExitStack
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
from statistics import median
import subprocess
from tempfile import TemporaryDirectory
from time import monotonic, sleep

ROOT = Path.cwd()
ESLINT = "node_modules/.bin/eslint"
OX = ["node_modules/.bin/oxlint", "--type-aware", "--max-warnings", "0"]
CLASSIC = {"no-dupe-args", "no-octal", "no-nonoctal-decimal-escape", "no-with"}


def report(message):
    print(message, flush=True)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        print(message, file=summary)


def relative(file):
    return Path(file).resolve().relative_to(ROOT).as_posix()


def run_json(command):
    process = subprocess.run(command, capture_output=True, text=True)
    if process.returncode not in (0, 1) or not process.stdout.lstrip().startswith(("[", "{")):
        raise RuntimeError(f"{command[:4]} exited {process.returncode}: {process.stdout} {process.stderr}")
    return process.returncode, json.loads(process.stdout)


def ox_rule(diagnostic):
    code = diagnostic.get("code") or ""
    match = re.fullmatch(r"([^()]+)\(([^()]+)\)", code)
    if not match:
        return code
    plugin, name = match.groups()
    return name if plugin == "eslint" else f"{plugin}/{name}"


def parity_probes(scratch):
    probes = json.loads(Path(__file__).with_name("lint-shadow-probes.json").read_text())
    with ExitStack() as stack:
        folders = {
            name: Path(stack.enter_context(TemporaryDirectory(prefix=".lint-parity-", dir=name)))
            for name in sorted({probe["directory"] for probe in probes})
        }
        paths = {}
        for probe in probes:
            slug = probe["eslint"].rsplit("/", 1)[-1]
            path = folders[probe["directory"]] / f"{slug}.{probe['extension']}"
            assert path not in paths, path
            path.write_text(probe["code"] + "\n")
            paths[path] = probe
        normal = [str(path) for path, probe in paths.items() if probe["eslint"] not in CLASSIC]
        classic = [str(path) for path, probe in paths.items() if probe["eslint"] in CLASSIC]
        _, old = run_json([ESLINT, "-f", "json", *normal])
        classic_config = scratch / "eslint-classic.mjs"
        classic_config.write_text("export default " + json.dumps([{
            "languageOptions": {"sourceType": "script", "ecmaVersion": 2026},
            "rules": dict.fromkeys(CLASSIC, "error"),
        }]))
        _, controls = run_json([ESLINT, "--config", str(classic_config), "-f", "json", *classic])
        _, new = run_json([*OX, "-f", "json", *normal, *classic])
        old_hits = {
            relative(result["filePath"]): {msg["ruleId"] for msg in result["messages"]}
            for result in [*old, *controls]
        }
        new_hits = defaultdict(set)
        for diagnostic in new["diagnostics"]:
            new_hits[relative(diagnostic["filename"])].add(ox_rule(diagnostic))

        failures = []
        exceptions = []
        for path, probe in paths.items():
            path_key = relative(path)
            old_rule, new_rule = probe["eslint"], probe["oxlint"]
            if old_rule not in old_hits.get(path_key, ()):
                failures.append(f"{old_rule}: ESLint fixture saw {old_hits.get(path_key)}")
            if new_rule and new_rule not in new_hits[path_key]:
                failures.append(f"{new_rule}: Oxlint fixture saw {sorted(new_hits[path_key])}")
            if not new_rule:
                exceptions.append(old_rule)
        if failures:
            report("\n".join(failures))
        report(f"Planted rules: {len(probes)} cases, {len(failures)} unexpected misses. "
               f"Classic-script exceptions: {', '.join(exceptions)}.")

        error = folders["scripts"] / "fatal-error.ts"
        error.write_text("debugger;\n")
        warning = folders["scripts"] / "fatal-warning.ts"
        warning.write_text("const lintWarning = 1; export {};\n")
        error_exit, error_output = run_json([*OX, "-f", "json", str(error)])
        warning_exit, warning_output = run_json([*OX, "-f", "json", str(warning)])
        allowed_exit, _ = run_json([*OX[:-1], "1", "-f", "json", str(warning)])
        assert error_exit == warning_exit == 1 and allowed_exit == 0, (
            error_exit, warning_exit, allowed_exit, error_output, warning_output)
        assert [(item["severity"], ox_rule(item)) for item in error_output["diagnostics"]] == [
            ("error", "no-debugger"),
        ], error_output
        assert [(item["severity"], ox_rule(item)) for item in warning_output["diagnostics"]] == [
            ("warning", "no-unused-vars"),
        ], warning_output
        report("Fatal thresholds: planted no-debugger error exits 1, planted no-unused-vars warning "
               "exits 1 at threshold 0 and exits 0 at threshold 1.")
    return not failures


def process_tree_rss(root_pid):
    children = defaultdict(list)
    memory = {}
    listing = subprocess.check_output(["ps", "-e", "-o", "pid=,ppid=,rss="], text=True)
    for row in listing.splitlines():
        pid, parent, rss = map(int, row.split())
        children[parent].append(pid)
        memory[pid] = rss
    pending = [root_pid]
    resident = 0
    while pending:
        pid = pending.pop()
        resident += memory.get(pid, 0)
        pending.extend(children[pid])
    return resident / 1024


def measure(command, output_path):
    with output_path.open("w") as output:
        start = monotonic()
        with subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT) as process:
            peak = 0
            while process.poll() is None:
                peak = max(peak, process_tree_rss(process.pid))
                sleep(0.2)
            return process.returncode, monotonic() - start, peak


def corpus(scratch, probes_ok):
    scan = subprocess.check_output(["npm", "run", "--silent", "lint:oxlint", "--", "--debug", "files"], text=True)
    new_files = {relative(file) for file in scan.splitlines()}
    results = {"ESLint": [], "Oxlint": []}
    for trial in range(5 if probes_ok else 1):
        scratch_old = scratch / f"eslint-{trial}"
        scratch_old.mkdir()
        shutil.rmtree(ROOT / "node_modules/.cache/eslint", ignore_errors=True)
        old_log = scratch / "eslint-run.txt"
        old = measure(["npm", "run", "lint", "--", str(scratch_old)], old_log)
        entries = [
            entry for batch in scratch_old.glob("*.json") for entry in json.loads(batch.read_text())
        ]
        old_files = {relative(entry["filePath"]) for entry in entries}
        new_log = scratch / "oxlint-run.txt"
        new = measure(["npm", "run", "lint:oxlint"], new_log)
        report(f"Trial {trial + 1}: ESLint {old[1]:.2f} s / {old[2]:,.0f} MiB / exit {old[0]}; "
               f"Oxlint {new[1]:.2f} s / {new[2]:,.0f} MiB / exit {new[0]}.")
        if trial == 0 or old_files != new_files:
            digest = sha256("\n".join(sorted(new_files)).encode()).hexdigest()
            report(f"Corpus: ESLint {len(old_files)} files; Oxlint {len(new_files)} files; Oxlint paths SHA256 {digest}.")
            if old_files != new_files:
                report(f"ESLint only: {sorted(old_files - new_files)}\nOxlint only: {sorted(new_files - old_files)}")
        print(new_log.read_text(), flush=True)
        if old[0] or new[0] or old_files != new_files or len(entries) != len(old_files) or not probes_ok:
            print(old_log.read_text(), flush=True)
            for entry in entries:
                for diagnostic in entry["messages"]:
                    report(f'ESLint: {relative(entry["filePath"])}:{diagnostic.get("line")}: {diagnostic["message"]}')
            raise RuntimeError("Root lint comparison failed")
        results["ESLint"].append(old)
        results["Oxlint"].append(new)
    for tool, trials in results.items():
        seconds = [trial[1] for trial in trials]
        memory = [trial[2] for trial in trials]
        report(f"{tool}: median wall {median(seconds):.2f} s ({min(seconds):.2f}–{max(seconds):.2f}); "
               f"median peak RSS {median(memory):,.0f} MiB ({min(memory):,.0f}–{max(memory):,.0f}).")


with TemporaryDirectory(prefix="relay-lint-shadow-") as temporary:
    scratch = Path(temporary)
    report(f"Same-SHA root lint comparison: `{os.environ['GITHUB_SHA']}` on Linux; "
           f"{os.cpu_count()} logical CPUs; Node {subprocess.check_output(['node', '--version'], text=True).strip()}. "
           "Peak is sampled process-tree RSS (200 ms), and shared pages can be counted more than once.")
    corpus(scratch, parity_probes(scratch))
