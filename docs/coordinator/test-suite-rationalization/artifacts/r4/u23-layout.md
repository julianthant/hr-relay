# R4 u23 — capability layout and truthful names

The directory remains organized by the dashboard capability each test observes. No broad folder
move was warranted: moving model, client, component, and fixture files away from their owning
surface would add import/path churn without changing test ownership.

Two name corrections were material:

| Intake path | Final path | Reason |
| --- | --- | --- |
| `queue-touch-target.test.ts` | `icon-button-semantics.test.ts` | The surviving assertions are generic primitive behavior, not queue geometry. |
| `top-bar-search-a11y.test.ts` | deleted | Its only case was layout class-token geometry and asserted no accessibility behavior. |

The new titles state behavior and failure condition directly:

- `IconButton semantics > forwards the caller's class to the native button`
- `IconButton semantics > uses the required label as the native button's accessible name`

The full focused verbose run prints `|unit|`, the file path, suite, and complete behavior title for
each case. No config or path-sensitive reference named either retired file, so no import/config
rewrite was necessary.

The post-change dashboard family contains 103 result files / 1,050 cases including the root
`dashboard-wire` owner, or 102 files / 1,038 cases below `tests/unit/dashboard/`. This is one fewer
file and six fewer cases than intake, exactly accounted for in u20.
