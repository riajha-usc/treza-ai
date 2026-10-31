# Treza AI

Autonomous, multi-tenant agentic banking copilot built on Airwallex. Treza unites pre-transaction spend control, dynamic seller settlement and automated chargeback defense into one closed loop, where risk signals from each stage inform the others through a shared event ledger.

Built for the Airwallex Agentic Banking Hackathon using Starter Kits 02, 04, 05 and 08.

> Status: Phase 1 (foundation) complete. The agents arrive in Phases 2 to 5.

## Quickstart

Requires Node 22 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The console runs with no keys at all, using embedded Postgres, and the Setup panel shows which integrations are still missing.

```bash
npm test          # unit and integration tests
npm run typecheck # TypeScript
```

## What Phase 1 provides

| Piece | Guarantee |
|---|---|
| Double-entry ledger | Every entry balances per currency, checked in code and again by the database at commit. Ledger and audit rows are append-only. |
| Integer money | Amounts are stored as minor units and converted to Airwallex major units only at the API boundary. |
| Shared event ledger | Airwallex webhooks and Treza's own events share one table. A redelivered webhook is recognised by its event id and dropped. |
| Webhook intake | HMAC-SHA256 over the timestamp and raw body, with a replay window, verified before any JSON is parsed. |
| Never pay twice | Each money-moving operation gets one Airwallex request_id, stored before the call and reused on every retry. |
| Audit trail | Every decision by rules, a model, a person or the system is recorded with its inputs and outcome. |
| Approval queue | One pending approval per subject. Human decisions are written to the audit trail. |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/webhooks/airwallex` | Airwallex webhook receiver |
| GET | `/api/health` | Setup checklist. Add `?check=airwallex` to test credentials. |
