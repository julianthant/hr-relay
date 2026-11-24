# Frontend rendering fixture

This isolated Vite entry mounts the real QueuePanel or LogFeed with synthetic records. It never
starts an HR workflow, reads credentials, or connects to the dashboard BFF.
The harness stylesheet imports the app stylesheet and registers the dashboard sources with Tailwind.

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

Queue renders all list lines up to 100, counting both rows and band headers. Above 100, it mounts
only lines in and near the viewport. Standalone Logs mounts all matching steps up to 200 and
windows them above 200. Embedded Logs mounts all matching steps at any count. Headers, controls,
and content outside the windowed lists stay mounted.

This fixture measures rendering. The full loaded data stays in memory for operations such as
selection, log search, and copy. Backend wiring still needs bounded paging and independent total counts.
