"""Partition the unfiltered Playwright listing, keeping trace files and gallery groups intact."""
import json
import sys
from collections import defaultdict
from pathlib import Path

TRACE_LANES = 2
GALLERY_LANES = 2
# Per-file test seconds from the smoke profile in run 45292546150.
TRACE_SECONDS = {
    "dashboard-analytics": 18, "dashboard-live-updates": 143, "dashboard-run-dialog": 64,
    "dashboard-runs": 48, "dashboard-settings-save": 18, "dashboard-shell": 40,
    "dashboard-sign-in": 4, "dashboard-skeletons": 187, "dashboard-speed": 9,
    "dashboard-spreadsheet-import": 10, "dashboard-worker-controls": 11,
    "dashboard-workflow-trace": 256, "dashboard": 4,
}


def lanes(kind, count):
    if count < 1:
        raise ValueError(f"{kind} requires a positive lane count")
    return [f"{kind}-{i + 1}" for i in range(count)]


def cases(suite, titles):
    for spec in suite.get("specs", []):
        project, = (test["projectName"] for test in spec["tests"])
        selector = " › ".join([f"[{project}]", spec["file"], *titles, spec["title"]])
        yield project, spec, selector
    for child in suite.get("suites", []):
        yield from cases(child, [*titles, child["title"]])


def pack(groups, names, weight):
    bins = {name: [] for name in names}
    loads = dict.fromkeys(names, 0)
    for group in sorted(groups, key=lambda key: (-weight(key), key)):
        lane = min(names, key=loads.__getitem__)
        bins[lane].extend(groups[group])
        loads[lane] += weight(group)
    return bins


def assignments(report, traces, gallery):
    files, groups = defaultdict(list), defaultdict(list)
    ids = set()
    for suite in report["suites"]:
        for project, spec, selector in cases(suite, []):
            case = (spec["id"], selector)
            if case[0] in ids:
                raise ValueError(f"duplicate discovered case {case[0]}")
            ids.add(case[0])
            if project == "smoke":
                files[spec["file"]].append(case)
            elif project == "gallery":
                tags = [tag for tag in spec["tags"] if tag.startswith("gallery-group:")]
                if tags:
                    group, = tags
                else:
                    group = "shared"
                groups[group].append(case)
            else:
                raise ValueError(f"unknown project {project}")
    # Estimate new trace files at five seconds per case and gallery groups by case count.
    return {**pack(files, traces, lambda f: TRACE_SECONDS.get(f.removesuffix(".smoke.ts"), 5 * len(files[f]))),
            **pack(groups, gallery, lambda g: len(groups[g]))}


if __name__ == "__main__":
    traces = lanes("traces", TRACE_LANES)
    gallery = lanes("gallery", GALLERY_LANES)
    matrix = [*traces, *gallery]
    if sys.argv[1:] == ["matrix"]:
        print(json.dumps({"lane": matrix}, separators=(",", ":")))
    else:
        lane, slots, directory = sys.argv[1:]
        if int(slots) != len(matrix):
            raise ValueError(f"expected {len(matrix)} lanes, got {slots}")
        root = Path(directory)
        assigned = assignments(json.loads((root / "smoke-list.json").read_text()), traces, gallery)[lane]
        if not assigned:
            raise ValueError(f"empty smoke lane {lane}")
        (root / "smoke-expected.json").write_text(json.dumps(sorted(case for case, _ in assigned)))
        (root / "smoke-tests.txt").write_text("\n".join(selector for _, selector in assigned))
