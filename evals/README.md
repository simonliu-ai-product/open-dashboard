# Skill evaluations

The skills are what an agent knows about open-dashboard, so a change to them is
judged by what an agent then builds. Each scenario is a task from a fresh
workspace and the bar its result must clear.

```bash
pnpm build                                      # the CLI the score runs on
npx @open-dashboard/cli init /tmp/eval-sales --sample
# give an agent the scenario's prompt in /tmp/eval-sales, with the skills installed
node scripts/skill-eval.mjs /tmp/eval-sales --scenario sales-overview
```

`skill-eval.mjs` runs `check --all-params` and `lint` and reports:

| Score | From | Why it matters |
| --- | --- | --- |
| `errors` | `check` | A dashboard that does not run is not done |
| `expectCoverage` | `-- expect:` rules | Share of queries whose numbers `check` can verify |
| `duplicates` | `lint duplicate-query` | Copied SQL drifts; shared SQL lives in `queries/` |
| `slowQueries` | `check --slow-ms` | A build pays each query once per stored run |
| `refreshWithoutLive` | `lint refresh-without-live-source` | Refresh no build elsewhere can honour |
| `failedRuns` | `check --all-params` | Filter combinations a reader can pick that break |

Run every scenario before and after a skill change and compare. A bar is
`maxX` (at most) or `minX` (at least) on a score. When agents keep missing the
same bar, that is something the framework or the skill should make easier —
not only something to tell them.
