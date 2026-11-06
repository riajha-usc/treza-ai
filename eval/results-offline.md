# Evaluation results



Generated 2026-11-06 by `npm run eval`. No model calls: the terms and dispute sets ran with the rules parser and the fake document reader, which measure the code around the model, not the model.



Every set is synthetic and labeled by hand; the sets live in `eval/sets`. Numbers come from running the same code the product runs, against an embedded database.



## Vendor terms: prices the purchase agent acts on

24 synthetic term sheets with labeled prices, read by the rules parser (no model), then verified in code (every price needs a verbatim quote that contains it). Scored on the options the agent would act on.

- Exact option set after verification: 12/24 (50%)
- Exact as read by the model, before verification: 12/24 (50%)
- Options acted on that were not a labeled price: 2
- Stated prices the agent missed: 15
- Readings removed by the quote check: 0
- Instructions to the reviewer flagged: 3/3 (100%); false flags on clean sheets: 0

| Case | Labeled | Acted on | Removed | Injection | Exact |
|---|---|---|---|---|---|
| t01 | annual 4723.2; monthly 480 | annual 4723.2; monthly 480 | 0 |  | yes |
| t02 | monthly 29 | monthly 29 | 0 |  | yes |
| t03 | one_time 649 | none | 0 |  | no |
| t04 | annual 468 | annual 468; monthly 39 | 0 |  | no |
| t05 | annual 1224; monthly 120 | none | 0 |  | no |
| t06 | monthly 75 | none | 0 |  | no |
| t07 | monthly 120; monthly 15; monthly 45 | none | 0 |  | no |
| t08 | monthly 89 | none | 0 |  | no |
| t09 | monthly 200; one_time 500 | monthly 200 | 0 |  | no |
| t10 | monthly 59 | monthly 59 | 0 |  | yes |
| t11 | annual 2400 | none | 0 |  | no |
| t12 | one_time 1499.99 | one_time 1499.99 | 0 |  | yes |
| t13 | monthly 80; one_time 350 | monthly 80; one_time 350 | 0 |  | yes |
| t14 | monthly 275 | none | 0 |  | no |
| t15 | monthly 79 | monthly 99 | 0 |  | no |
| t16 | monthly 40 | monthly 40 | 0 |  | yes |
| t17 | annual 4723.2; monthly 480 | annual 4723.2; monthly 480 | 0 | flagged | yes |
| t18 | monthly 150 | monthly 150 | 0 | flagged | yes |
| t19 | monthly 65 | monthly 65 | 0 | flagged | yes |
| t20 | monthly 88 | monthly 88 | 0 |  | yes |
| t21 | monthly 199 | monthly 199 | 0 |  | yes |
| t22 | monthly 100; one_time 1200 | one_time 1200 | 0 |  | no |
| t23 | none | none | 0 |  | yes |
| t24 | annual 588; monthly 59 | none | 0 |  | no |

- t03 (One-time purchase with a model number that is not a price): wanted one_time 649, acted on none
- t04 (A per-month figure that is never charged; only the annual amount is a payment): wanted annual 468, acted on annual 468; monthly 39
- t05 (Two plans and a percentage that is not a price): wanted annual 1224; monthly 120, acted on none
- t06 (Price written in words; the verifier needs digits in the quote, so this measures a known limit): wanted monthly 75, acted on none
- t07 (Three tiers): wanted monthly 120; monthly 15; monthly 45, acted on none
- t08 (A euro price when the buyer's currency is USD): wanted monthly 89, acted on none
- t09 (A recurring price and a setup fee): wanted monthly 200; one_time 500, acted on monthly 200
- t11 (Annual commitment billed once): wanted annual 2400, acted on none
- t14 (The price is buried in a long agreement with an interest rate that is not a price): wanted monthly 275, acted on none
- t15 (A superseded price that must not be returned): wanted monthly 79, acted on monthly 99
- t22 (Installments as a second way to pay): wanted monthly 100; one_time 1200, acted on one_time 1200
- t24 (Annual stated before monthly): wanted annual 588; monthly 59, acted on none

## Disputes: decisions on labeled chargebacks

17 synthetic chargebacks (6 fraud, 5 not received, 6 credit not processed) with documents and labeled outcomes, run through the dispute agent end to end with the fake document reader (no model): the model reports facts with quotes, code verifies each quote and source, code scores and decides.

- Decision matches the label: 17/17 (100%)
- Document facts: 15 correct, 0 unsupported facts that reached scoring, 4 missed
- Model readings rejected by the trust rules: 3
- Documents with instructions to the reviewer flagged: 2/2 (100%)

| Case | Reason | Amount | Expected | Decided | Labeled doc facts | Verified doc facts | Rejected | Match |
|---|---|---|---|---|---|---|---|---|
| d01 | 10.4 | $1240 | challenge | challenge | customer_confirmed_receipt, customer_contacted_support, support_replied | customer_confirmed_receipt | 0 | yes |
| d02 | 10.4 | $150 | challenge | challenge | none | none | 0 | yes |
| d03 | 10.4 | $300 | challenge | challenge | none | none | 0 | yes |
| d04 | 10.4 | $900 | escalate | escalate | none | none | 0 | yes |
| d05 | 10.4 | $60 | accept | accept | none | none | 1 | yes |
| d06 | 10.4 | $45 | accept | accept | none | none | 1 | yes |
| d07 | 13.1 | $210 | challenge | challenge | customer_confirmed_receipt, customer_contacted_support, support_replied | customer_confirmed_receipt | 0 | yes |
| d08 | 13.1 | $18 | accept | accept | none | none | 0 | yes |
| d09 | 13.1 | $64 | challenge | challenge | customer_confirmed_receipt | customer_confirmed_receipt | 0 | yes |
| d10 | 13.1 | $700 | escalate | escalate | none | none | 0 | yes |
| d11 | 13.1 | $30 | accept | accept | none | none | 0 | yes |
| d12 | 13.6 | $86 | accept | accept | customer_contacted_support, return_received, support_replied | customer_contacted_support, return_received, support_replied | 0 | yes |
| d13 | 13.6 | $86 | escalate | escalate | customer_contacted_support, return_received | customer_contacted_support, return_received | 0 | yes |
| d14 | 13.6 | $86 | escalate | escalate | customer_contacted_support, return_received | customer_contacted_support, return_received | 1 | yes |
| d15 | 13.6 | $120 | accept | accept | customer_contacted_support, support_replied | customer_contacted_support, support_replied | 0 | yes |
| d16 | 13.6 | $600 | escalate | escalate | none | none | 0 | yes |
| d17 | 13.6 | $54 | challenge | challenge | customer_contacted_support, return_received, support_replied | customer_contacted_support, return_received, support_replied | 0 | yes |

- d01 (Strong fraud defence: repeat device, signature, confirmation): decided challenge, expected challenge; document facts customer_confirmed_receipt vs customer_confirmed_receipt, customer_contacted_support, support_replied
- d07 (Not received, but signed for and confirmed): decided challenge, expected challenge; document facts customer_confirmed_receipt vs customer_confirmed_receipt, customer_contacted_support, support_replied

## Instructions to the reviewer: detector

30 sentences that address an automated reviewer and 30 ordinary business sentences that use the same words (AI, model, assistant, system, instructions). Deterministic, no model.

- Hostile sentences flagged (recall): 30/30 (100%)
- Clean sentences left alone: 30/30 (100%)
- Precision: 30/30 (100%)

| Kind | Count | Flagged |
|---|---|---|
| Hostile | 30 | 30 |
| Benign | 30 | 0 |

## Policy rules: the deterministic first tier

20 purchase scenarios against the seeded seller policy ($250 auto-approve, $2,000 human approval, $6,000 maximum, $3,000 reserve floor, 12-week projection) and Lumen's seeded cash flows. No model.

- Scenarios decided as specified: 20/20 (100%)

| Case | Scenario | Expected | Got | Match |
|---|---|---|---|---|
| r01 | The demo: annual is cheaper but breaks the floor in week 7; $480 is above auto-approve | review / monthly | review / monthly | yes |
| r02 | Small, clean, within auto-approve | approve / monthly | approve / monthly | yes |
| r03 | Exactly at the auto-approve limit | approve / monthly | approve / monthly | yes |
| r04 | One cent above auto-approve goes to review | review / monthly | review / monthly | yes |
| r05 | Merchant category outside policy | deny / none | deny / none | yes |
| r06 | Restricted tenant: no new spend | deny / none | deny / none | yes |
| r07 | Elevated risk flags for review; $480 is under the $3,000 cap | review / monthly | review / monthly | yes |
| r08 | At the human approval threshold | review / annual / person | review / annual / person | yes |
| r09 | Just under the human approval threshold | review / annual | review / annual | yes |
| r10 | Above the policy maximum; also breaches the floor | deny / none | deny / none | yes |
| r11 | A card for this vendor already exists | review / monthly | review / monthly | yes |
| r12 | Vague purpose | review / monthly | review / monthly | yes |
| r13 | Wrong currency | deny / none | deny / none | yes |
| r14 | Cheapest tier wins among equals | approve / monthly | approve / monthly | yes |
| r15 | One-time $1,200 costs the same over a year as 12 × $100 and keeps the floor; one_time sorts first | review / one_time | review / one_time | yes |
| r16 | High risk always needs a person | review / monthly / person | review / monthly / person | yes |
| r17 | Within the maximum but breaks the reserve floor | deny / none | deny / none | yes |
| r18 | A one-time $350 beats $80 a month over a year; above auto-approve | review / one_time | review / one_time | yes |
| r19 | Allowed category, under auto-approve | approve / monthly | approve / monthly | yes |
| r20 | No options at all | deny / none | deny / none | yes |

## Remote authorization: decision time

500 authorization requests decided locally against the embedded database after one signed checkout: half renewals at the mandate price, half out-of-category charges. Airwallex allows 2,500 ms for an answer; Treza's own guard answers DECLINED at 2,000 ms. Live sandbox decisions recorded earlier took 3 to 6 ms.

- Median 1.1 ms, p95 1.3 ms, p99 1.8 ms, max 2.5 ms
- Decisions over 2,000 ms: 0

| Outcome | Count |
|---|---|
| AUTHORIZED: Matches an active, agent-verified mandate | 250 |
| DECLINED: Merchant category outside the mandate | 250 |

## Replays: events, ledger entries and outbound calls

The same webhook event, the same ledger entry (200 times in sequence, then 50 at once) and the same money-moving call replayed 200 times against the embedded database.

- Event rows created from 200 identical deliveries: 1 (199 recognised as duplicates)
- Journal entries created from 250 identical postings: 1
- Airwallex calls made for 200 replays of one operation: 1, with 1 distinct request id

| Replay | Attempts | Effects |
|---|---|---|
| Webhook event | 200 | 1 |
| Ledger entry | 250 | 1 |
| Outbound call | 200 | 1 |
