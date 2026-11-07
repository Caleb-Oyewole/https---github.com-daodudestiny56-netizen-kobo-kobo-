# kobo-core

Core backend for Kobo Kobo (Access Youth Tech Forge 2026, Payments): nightly 11 PM auto-sweep, 50/50 double-entry ledger,
emergency withdrawals, USSD and two-way SMS, SMS outbox, PFA simulator and reconciliation.

```
cp .env.example .env
docker compose up -d db        # or any Postgres 16
npm install
npm run migrate
npm run dev
npm test                       # needs DATABASE_URL pointing at a throwaway Postgres
```

Integration contract for the Rails service: [docs/RAILS_HANDOFF.md](docs/RAILS_HANDOFF.md).
`EXECUTOR_MODE=mock` runs without Rails; `http` uses `RAILS_BASE_URL`.

Layout: `src/split` (allocation), `src/ledger`, `src/sweeps` (service, batch, scheduler), `src/withdrawals`,
`src/channels` (USSD, SMS; en + Pidgin), `src/security` (PIN), `src/smart-rate`, `src/voice` (IVR), `src/sms` (outbox, dispatcher), `src/pfa`, `src/reconciliation`, `src/routes`.
