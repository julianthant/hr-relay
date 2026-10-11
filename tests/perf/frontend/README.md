# Frontend rendering fixture

This isolated Vite entry mounts the real QueuePanel or LogFeed with synthetic records. It never
starts an HR workflow, reads credentials, or connects to the dashboard BFF.

Build and serve:

```sh
npm exec vite -- build --config tests/perf/frontend/vite.config.ts
npm exec vite -- preview --config tests/perf/frontend/vite.config.ts
```

Open `http://127.0.0.1:54820/?kind=queue&count=1240` or
`http://127.0.0.1:54820/?kind=logs&count=20000`. Counts are bounded to 1–20,000. Queue selection
and log search, copy, exact-step jump and latest-action navigation exercise their production components.
`document.body.dataset.ready` records render-through-two-animation-frame time. The fixture's
`disposeFixture` function unmounts the root for heap cleanup measurements.

Comparable baseline and candidate samples use identical fixture inputs, stable row handlers/view
sets, a 1440×900 headless Chromium viewport and production builds. Each case has three or five
repetitions. Report medians and the sample maximum; these small samples do not establish a population
p95, device-independent SLO or service throughput. Action timing includes Playwright dispatch and
scrolling. Heap samples follow Chromium garbage collection; repeated post-unmount samples test cleanup.

This is a measurement tool, not a frozen visual reference or a passing performance budget. Queue and
logs retain all loaded DOM records. Backend wiring must preserve bounded paging and independent total
counts; offscreen layout deferral does not replace pagination or reduce retained record memory.
