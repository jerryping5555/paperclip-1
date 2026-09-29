# Paperclip Agent Schedules

Last updated: 2026-09-27

All crons run in `Australia/Melbourne` (UTC+10; UTC+11 from 2026-10-05) except the
Sender.net relay, which is UTC-fixed. Melbourne-based crons shift together, so
relative spacing is preserved across the DST change.

## Master schedule

| Day (UTC) | Org | Routine | Agent | UTC | Melbourne |
|---|---|---|---|---|---|
| Daily | Potatodev | CTO nightly audit and report | CTO | 11:00 | 21:00 |
| Sun | KIDAA | Weekly SEO audit + director report | SEO Agent | 15:00 | Mon 01:00 |
| Sun | KIDAA | Product drop-zone sweep | Chief of Staff | 16:00 | Mon 02:00 |
| Sun | KIDAA | Social product posts (FB + Pinterest) | FB Pinterest Agent | 18:00 | Mon 04:00 |
| Mon | KIDAA | Sender.net weekly metrics relay | Chief of Staff | 12:00 (UTC-fixed) | 22:00 |
| Mon | KIDAA | Weekly marketing review + plan update | Marketing Agent | 15:00 | Tue 01:00 |
| Tue | KIDAA | Social product posts | FB Pinterest Agent | 18:00 | Wed 04:00 |
| Thu | Jetson | Weekly Jetson health + backup | Jetson Health | 16:00 | Fri 02:00 |
| Thu | Jetson | Weekly Jetson security highlights | Jetson Guard | 17:15 | Fri 03:15 |
| Fri | KIDAA | Social product posts | FB Pinterest Agent | 18:00 | Sat 04:00 |

## By day

- **Daily** — Potatodev audit, 11:00 UTC
- **Sunday** — KIDAA: 15:00, 16:00, 18:00 UTC
- **Monday** — KIDAA: 12:00, 15:00 UTC
- **Tuesday / Friday** — KIDAA social, 18:00 UTC
- **Thursday** — Jetson: 16:00, 17:15 UTC

## Cron expressions

| Routine | Cron | Timezone |
|---|---|---|
| CTO nightly audit and report (Potatodev) | `0 21 * * *` | Australia/Melbourne |
| Weekly SEO audit + director report | `0 1 * * 1` | Australia/Melbourne |
| Product drop-zone sweep | `0 2 * * 1` | Australia/Melbourne |
| Social product posts (FB + Pinterest) | `0 4 * * 1,3,6` | Australia/Melbourne |
| Sender.net weekly metrics relay | `0 12 * * 1` | UTC |
| Weekly marketing review + plan update | `0 1 * * 2` | Australia/Melbourne |
| Weekly Jetson health + backup | `0 2 * * 5` | Australia/Melbourne |
| Weekly Jetson security highlights | `15 3 * * 5` | Australia/Melbourne |

KidsFaithAcademy has no routines (agent paused).
