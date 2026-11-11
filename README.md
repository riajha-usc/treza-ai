# Treza AI

Autonomous, multi-tenant agentic banking copilot built on Airwallex. Treza unites pre-transaction spend control, dynamic seller settlement and automated chargeback defense into one closed loop, where risk signals from each stage inform the others through a shared event ledger.

Built for the Airwallex Agentic Banking Hackathon using Starter Kits 02, 04, 05 and 08.

> Video : https://youtu.be/3XNyHMeLmpY. 

> Live: [open the hosted console](https://tr-220e6fb16d0a439eb719cb7274205204.ecs.us-west-2.on.aws/?key=26851a0576e99e489458888d493216e7)

> Docs: [Treza-Technical-Documentation.pdf](Treza-Technical-Documentation.pdf)

> Status: purchases, the Visa agent checkout, settlement, bridging, disputes and a real refund have all run against the Airwallex sandbox; every ID is in Appendix A of the [technical documentation](Treza-Technical-Documentation.pdf). The two Visa pieces that need Visa credentials are labeled stand-ins. Measured numbers are in [Measured, not claimed](#measured-not-claimed).

## What Treza does

A marketplace is a small bank it never meant to run: it approves what sellers spend, holds their money between sale and payout, and answers the chargebacks. Treza runs those three jobs as one loop, with one double-entry ledger and one risk record per seller.

- **Before the transaction.** Claude Sonnet 5.5 reads vendor terms and must quote every price word for word; code verifies each quote, projects twelve weeks of cash, and decides. A person approves above the threshold, never the requester. The approval becomes an Airwallex card limited to that charge, that merchant category and that month, so everything else declines at the network. The seller's agent checks out with a request signed under Visa Trusted Agent Protocol.
- **During settlement.** Each seller's reserve comes from its refund rate, tenure, risk tier, open chargebacks and known exposure, with every term written out. The rest is paid once by a real transfer. A carrier failure recalculates only that seller; late deposits are bridged from a facility that never lends against reserves; the wallet is reconciled against the ledger after every move.
- **After the transaction.** Claude Opus 5.5 finds facts in dispute evidence and must quote them; code checks every quote against its document and every fact against the kind of document that can prove it. Instructions aimed at the reviewer are flagged, audited and ignored. Code scores the evidence per reason code and challenges only when the fee plus the expected loss beats accepting.
- **The loop.** A chargeback or a lost shipment raises that seller's risk tier, which raises its reserve and halves the purchase agent's ceiling for it, with nobody editing a policy.

Models read documents and recommend. Code sets every amount, limit and account. The card network enforces the limits.

## Quickstart

Requires Node 22 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. The console runs with no keys at all, using embedded Postgres, and the Overview shows a setup banner while integrations are missing. Add Airwallex sandbox keys to issue cards and settle sellers, and a Claude key to let the models read documents.

```bash
npm test          # 100 unit and integration tests, offline, against embedded Postgres
npm run eval      # the labeled evaluation sets, offline; eval:models adds one pass of Claude calls
npm run typecheck # TypeScript
npm run lint
```

## Measured, not claimed

`npm run eval` runs labeled sets through the same code the product runs and writes [eval/results.md](eval/results.md); `npm run eval:models` adds one pass of real model calls. The sets are synthetic and hand-labeled, in `eval/sets`. Numbers below are from the Nov 4 and 5 2026 runs with Claude Sonnet 5.5 reading terms and Claude Opus 5.5 reading dispute documents.

| What | Set | Result |
|---|---|---|
| Prices the purchase agent acts on | 24 vendor term sheets, 3 with injected instructions | 22 to 23 of 24 exact after code verified every quote, across three passes; 0 prices invented; the model itself read 23 to 24 of 24 |
| Dispute decisions | 17 chargebacks across three reason codes, 2 with injected notes, 1 refunded through Treza before the chargeback | 17 of 17 decisions match the labels; 3 model readings rejected by the trust rules (seller statements, documents that address the reviewer); both injected documents flagged |
| Instructions aimed at the reviewer | 30 hostile sentences, 30 clean ones using the same words | 30 of 30 caught, 30 of 30 clean left alone, after tuning on this set; the first measurement caught 17 of 30 |
| Policy rules | 20 purchase scenarios against the seeded policy | 20 of 20 as specified |
| Remote authorization time | 500 decisions against the embedded database | median 1.1 ms, p99 2.1 ms, max 2.4 ms; live sandbox 3 to 6 ms; Airwallex allows 2,500 ms |
| Replays | 200 identical webhooks, 250 identical postings, 200 replays of one transfer | 1 event, 1 journal entry, 1 Airwallex request |

What the misses are: the one terms miss is a price written in words ("seventy-five dollars"), which the model read correctly and the quote check refused because the quote carries no digits. Two model passes differed by one case (a "12-month agreement billed upfront" read once as one-time, once as annual), so the number is 22 to 23 of 24, not a constant. The detector numbers are not held out: it was widened after the first measurement until it caught the set.

## Documentation

[Treza-Technical-Documentation.pdf](Treza-Technical-Documentation.pdf) is the full technical reference: system architecture and the agentic pipeline, the purchase, settlement and dispute agents, Visa agent commerce, the controls a bank would ask about, the console, the HTTP endpoints and webhook events, the AWS deployment, the measured results, and every sandbox ID from the live runs.

Also in the repository: [eval/results.md](eval/results.md) for the evaluation output, [deploy/README.md](deploy/README.md) for the hosted setup, and `src/lib/db/migrations.ts` for every table, constraint and trigger.
