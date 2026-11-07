# Kobo Kobo core: handoff to the Rails service

Base URL: core service (`PORT`, default 3000). Internal routes need `Authorization: Bearer $SERVICE_TOKEN`
(open if unset, dev only). Money is a decimal string in naira (`"900.00"`); never a float.

## 1. Schema

`migrations/001..003_*.sql`, applied in order by `npm run migrate` (records `schema_migrations`).
Canonical naming follows PRD v2 (`bank_reference`, `is_excluded_from_sweep`). Core owns migrations; Rails should read, not alter.
Key constraints: `UNIQUE (merchant_id, sweep_date)` on `daily_sweeps`; `merchant_id` is unique on `pension_accounts`;
`ledger_entries` is append-only (triggers block UPDATE/DELETE and reject unbalanced journals).
Rails writes `merchants` and `inflow_transactions`; core writes `daily_sweeps`, `ledger_entries`, `pension_accounts` balances.

## 2. Split engine

`POST /api/v1/split` `{ merchant_id, sweep_date, sweep_amount }` returns:
`allocations.emergency_pot` (floor of half), `allocations.retirement_pot` (remainder), `pension_reference`
(`PEN-YYYYMMDD-NNNNNN`, reserved idempotently per merchant/date) and `ledger_entries`
(DEBIT MERCHANT_CASH, CREDIT EMERGENCY_POT, CREDIT RETIREMENT_POT).
Errors (`{ error: { code, message } }`): 400 `INVALID_AMOUNT` or bad date, 404 `MERCHANT_NOT_FOUND`,
422 `PENSION_ACCOUNT_MISSING` (issue an RSA PIN first), 422 `AMOUNT_EXCEEDS_DAILY_CAP`,
409 `SWEEP_ALREADY_EXECUTED` / `SWEEP_ALREADY_RESOLVED`, 409 `SWEEP_AMOUNT_CONFLICT` (a pending sweep for that date has a different amount). It does not move money.

## 3. Cron contract and retries

Core owns the schedule. At 23:00 Africa/Lagos it runs the nightly batch itself: for each merchant it computes
`min(floor(takings x rate), daily_cap)` over the PRD v2 window [00:00 D, 23:00 D) WAT (takings in the 23:00-24:00 hour are in no window; reconciliation reports them as `unswept_late_inflows`), skips paused / zero-sales / below-buffer,
asks the guard, persists the sweep as PENDING, then calls **your executor endpoints**:

| Call | Contract |
|---|---|
| `GET /api/v1/executor/balance?nuban=` | `{ available_balance }` |
| `POST /api/v1/executor/debit` + `Idempotency-Key: sweep:<merchantId>:<date>` | body `{ merchant_id, nuban, amount, narration, pension_reference }` -> `{ debit_reference, amount }` |
| `POST /api/v1/executor/credit` + `Idempotency-Key: withdrawal:<id>` | body `{ nuban, amount, narration }` -> `{ credit_reference }` |
| `GET /api/v1/executor/debits?sweep_date=` | `{ debits: [{ idempotency_key, nuban, amount, debit_reference }] }` |

Rules for Rails: the same idempotency key must never move money twice (replay returns the original result; a different
amount is `IDEMPOTENCY_CONFLICT`). Errors are non-2xx `{ error: { code, message } }` with code one of `TIMEOUT`,
`UNAVAILABLE` (retryable, outcome unknown), `INSUFFICIENT_FUNDS`, `REJECTED`, `ACCOUNT_BLOCKED`, `IDEMPOTENCY_CONFLICT` (final).
408/429/5xx are treated as retryable.

**Retry/backoff is owned by core:** 3 in-run tries with exponential backoff (`SWEEP_BACKOFF_BASE_MS`), a re-run at 23:30
(`SWEEP_RETRY_CRON`), up to 6 attempts total. Re-runs are idempotent. Rails does not retry sweeps.
Manual triggers: `POST /api/v1/sweeps/nightly-batch { target_date, allow_early? }` and
`POST /api/v1/sweeps/execute { merchant_id, target_date, allow_early? }` (409 `WINDOW_STILL_OPEN` before 23:00 WAT unless `allow_early`).
Batch summary matches PRD 6.1 (processed, successful, zero_sales, paused, buffer, guard held, failed, pending_retry, total swept).

Alternative if Rails performs the debit itself: after a confirmed debit call
`POST /api/v1/sweeps/settle { merchant_id, sweep_date, sweep_amount, debit_reference }`. It posts the ledger, credits both pots,
queues the SMS receipt, and is idempotent (`already_settled: true` on repeat).

## 4. PFA simulator and SMS receipt

- Onboarding: `POST /api/v1/pfa/rsa-pin { merchant_id }` returns a mock ECRS RSA PIN (201 new, 200 if one exists).
- Receipt: you do not call a hook. Core queues the SMS in a transactional outbox in the same transaction that settles the
  sweep, so a receipt exists if and only if the sweep settled. A dispatcher sends it via Africa's Talking with retries.
- `GET /api/v1/merchants/:id/pension` gives balances and whether the Emergency Pot is open. `POST /api/v1/withdrawals { merchant_id, amount }` pays it back to the trader's own account (3 months after first contribution, then 60-day cooldown).

## 5. Pause and rate fields

USSD (`4`, `3`) and SMS (`PAUSE`/`STOP`, `RESUME`/`START`, `RATE n`) write exactly:
`merchants.is_paused`, `merchants.paused_until` (now + 48h on pause; cleared on resume), `merchants.sweep_percentage` (1 to 5, up to 2 decimals).
A sweep is skipped when `is_paused AND (paused_until IS NULL OR paused_until > now)`. Covered by `tests/channels.test.ts`.

## 5b. PIN (money-out security)

4-digit PIN, stored only as a salted scrypt hash (peppered with `PIN_PEPPER`). Three wrong tries lock it for 30 minutes
(`PIN_MAX_ATTEMPTS`, `PIN_LOCK_MINUTES`), the trader is texted, and the counter is race-safe under parallel guessing.
PINs are set from an authenticated app session, never from USSD (a SIM swapper could otherwise create the PIN meant to stop them).

| Call | Notes |
|---|---|
| `POST /api/v1/merchants/:id/pin { pin, reset? }` | onboarding; 204. 409 `PIN_ALREADY_SET` unless `reset: true` (use after ops identity check) |
| `POST /api/v1/merchants/:id/pin/verify { pin }` | 200 `{ valid }`, 401 `PIN_INVALID` (`details.attempts_remaining`), 423 `PIN_LOCKED`, 422 `PIN_NOT_SET` |
| `POST /api/v1/merchants/:id/pin/change { old_pin, new_pin }` | 204 |
| `GET /api/v1/merchants/:id/pin` | `{ pin_set }` |

`POST /api/v1/withdrawals` now needs `pin` (set `WITHDRAWAL_PIN_REQUIRED=false` only for local demos). USSD withdrawal asks for it last;
USSD option 7 changes it. Weak PINs (1111, 1234, 4321, end of the phone number) are refused with 422 `PIN_TOO_WEAK`.

## 6. Reconciliation

`GET /api/v1/reconciliation?date=YYYY-MM-DD` compares core, the bank (`/executor/debits`) and the ledger and returns
`{ ok, totals, flags[] }` with flags `MISSING_DEBIT`, `AMOUNT_MISMATCH`, `ORPHAN_DEBIT`, `LEDGER_MISMATCH`, `STUCK_SWEEP`,
`FAILED_SWEEP`, `POT_DRIFT`, `PENDING_WITHDRAWAL`.

## Telco webhooks (Africa's Talking)

`POST /api/v1/ussd` and `POST /api/v1/sms/inbound` accept form or JSON, guarded by `?token=$WEBHOOK_TOKEN`.
