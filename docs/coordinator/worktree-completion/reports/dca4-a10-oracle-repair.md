# DCA4 A10.4T oracle repair

Permanent scope is exactly `tests/unit/dashboard/run-captures-app.test.ts` (+44/-6), final SHA256 `68ca95defa1ee43c6ad1d759487c3b4ebe2e244cf4130cb9216e5d745428fc84`. No product or AGENTS bytes remain changed by this lane.

The new same-node lifecycle oracle starts and proves a deferred decoder, dispatches `error` on that mounted image, resolves the earlier decoder, and requires refusal to remain while preserving metadata and the exact native URL. Removing only error-time attempt invalidation produced the intended 1-test red; exact source restoration returned it green.

The tile/preview provenance cases now compare independently authored exact rendered `(originKind, bundleId)` rows for all five closed kinds. Rotating labels across IDs while retaining every individual string produced the intended 2-test red; exact component restoration returned both green.

Final proof: app + lifecycle + fixture + wire files passed 101/101 serially; globally locked typecheck and lint exited 0. Raw receipts and control patches are under `evidence/dca4-a10-oracles-*`; incremental delta SHA256 is `6c06a455d49b0faf1d59a2c10b0e36e4427f5d888737aa1a93ff687ad99c273b`.

Identity: HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`, index empty; model/component restored to `001c9058…` / `2daa099d…`; post-F fixture/test/AGENTS pins remain `b300ee04…` / `1231018c…` / `a2f6f101…`. Protected 1,869-path digest remained `0afdda3893ca108ff310a23aa1dff0484f203c10ca5b041ada49431832131c88`.

Limitation: decoder behavior is simulated in jsdom. No browser, parity, coverage, build, or heavy gate ran, and this report makes no browser-readiness claim. Writer/light lane released.
