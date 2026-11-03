# Treza AI

Autonomous, multi-tenant agentic banking copilot built on Airwallex. Treza unites pre-transaction spend control, dynamic seller settlement and automated chargeback defense into one closed loop, where risk signals from each stage inform the others through a shared event ledger.

Built for the Airwallex Agentic Banking Hackathon using Starter Kits 02, 04, 05 and 08.

> Status: Phases 1 to 5 built: foundation, purchase agent, dispute agent, settlement and bridging, and Visa agent commerce.

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

## Purchase agent (Kits 02 and 05)

Open `/purchases`, choose **Load example** and submit. The demo marketplace is seeded on first boot.

1. **Terms read.** Claude Sonnet 5.5 reads the vendor quote, or a rules parser when no Claude key is set. Every price must appear verbatim in the vendor text, or it is rejected.
2. **Rules.** Currency, blocked vendors, merchant category, tenant risk, and a 12-week cash projection per option against the reserve floor. The cheapest option that keeps cash above the floor wins.
3. **Model review.** Claude weighs only what the rules flag, such as purpose and amount above the auto-approval limit. It never sets an amount or a limit. A refusal or outage routes to a person.
4. **Approval.** Above the threshold, a person approves. The approval is bound by fingerprint to the exact terms and card controls, and live conditions such as tenant risk are re-checked before issuing.
5. **Card.** A virtual card is issued on behalf of the tenant's connected account, with per-transaction, monthly and total limits, a merchant category lock and an expiry. Sandbox buttons show the monthly charge clearing while the annual price and a restaurant decline.

## Dispute agent (Kit 04)

Open `/disputes` and choose **Stage demo disputes**. Treza pays for three demo orders in your Airwallex sandbox with the test card, opens a dispute on each, and decides:

| Case | Evidence | Decision |
|---|---|---|
| $1,240 fraud claim, reason 10.4 | Three earlier undisputed orders from the same device and IP, and a signed delivery | Challenge with an evidence PDF |
| $18 not-received claim, reason 13.1 | Mailbox scan with no signature; the challenge fee exceeds the amount | Accept |
| $86 refund claim, reason 13.6 | The customer emailed support twice with no reply | A person decides |

- **Facts need a source.** Code derives facts from order records. Claude Opus 5.5 finds facts in documents and must quote them word for word; any quote not found in the cited document is rejected.
- **Code decides.** Evidence is scored per Visa reason code, and Treza challenges only when the fee plus the expected loss beats accepting.
- **Never the same evidence twice.** After an issuer rejection, Treza asks the seller for more records and sends only new documents.
- **Closed loop.** Each dispute raises the seller's risk once, which tightens that seller's card purchases.

Run it from the command line with `node --env-file=.env --import tsx scripts/stage-disputes.mts`.

## Settlement and bridging (Kits 08 and 05)

Open `/sellers` and run the five demo steps in order.

1. **Onboard sellers.** Each seller becomes an Airwallex connected account with its own wallet and Global Account. Onboarding needs sandbox identity values you add yourself as `SELLER_IDENTITIES` in `.env` (see `.env.example`). Treza never creates identifier numbers.
2. **Run a settlement cycle.** Buyer payments land in the platform wallet. Each seller's reserve comes from its own refund rate, tenure, risk tier, open chargebacks and known exposure, with a written reason for every term. The rest is paid once to the seller's connected account.
3. **Carrier failure at one seller.** Only that seller's reserve is recalculated. Treza checks the seller's wallet before charging the shortfall, and records anything it cannot cover as owed, netted from the next payout.
4. **Bridge late deposits.** A deliberately scarce facility never lends against seller reserves, refuses high-risk sellers, and funds the smallest eligible requests first.
5. **The late deposit arrives.** The bridge is charged back after a wallet check.

**Reconcile** compares how much the platform wallet moved with how much the ledger says it moved, since the sandbox wallet is pre-funded.

## Visa agent commerce: TAP, VIC and remote authorization

On a purchase with an issued card, panel **6. Verified agent checkout** runs one real-time chain:

1. **Mandate (VIC).** The approved purchase becomes a purchase instruction in Visa Intelligent Commerce's documented shape: purchase type, decline threshold, merchant name, merchant category and expiry.
2. **Signed checkout (TAP).** The agent signs its checkout request with Visa Trusted Agent Protocol: RFC 9421 HTTP Message Signatures over `@authority` and `@path`, Ed25519, an 8-minute window, a session nonce and the `agent-payer-auth` tag. The consumer object and payment container in the body are signed with the same key and nonce.
3. **Merchant verification.** A demo merchant runs every step of Visa's merchant spec and rejects replays and forged signatures.
4. **Issuer-side decision.** Treza answers the card authorization from its own records in milliseconds, with no model in the path: card active, seller not restricted, mandate current, merchant category, per-charge limit, mandate total, and a merchant-verified signed intent for the first charge.

The agent's public key is served at `/api/tap/keys`. Airwallex remote authorization calls `/api/airwallex/remote-auth` once its URL and `AIRWALLEX_REMOTE_AUTH_SECRET` are configured; until then Treza computes the same answer before charging in the sandbox.

**Stated plainly:** the agent is not yet registered with Visa, so the key directory is a self-hosted stand-in for Visa's Key Store. The VIC client is a labeled stand-in, because VIC sandbox calls need Visa onboarding credentials. The Airwallex card is not tokenized through Visa. Airwallex can still decline a charge Treza approves.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/webhooks/airwallex` | Airwallex webhook receiver |
| GET | `/api/health` | Setup checklist. Add `?check=airwallex` to test credentials. |
| POST | `/api/airwallex/remote-auth` | Airwallex remote authorization: approve or decline each card charge |
| GET | `/api/tap/keys` | The agent's TAP public key directory (JWK) |
| GET | `/api/disputes/{id}/evidence` | The evidence PDF for a dispute |
