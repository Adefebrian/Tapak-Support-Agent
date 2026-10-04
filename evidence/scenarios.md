# Scenario matrix

The 40-case eval scores the system against the PRD's categories. The scenario matrix asks a different question: does the agent cope with the many ways real customers actually say things? It holds 52 rows in [`eval/scenarios.yaml`](../eval/scenarios.yaml), runs as a test (`apps/server/test/scenarios.test.ts`), and checks the action, the cited page where one is expected, and that no other customer's data appears.

| Category | Rows | What it covers |
| --- | --- | --- |
| policy | 14 | Returns, exchanges, couriers, care, warranty, vouchers, payment, support hours, shipping abroad, stores, loyalty, gift cards |
| products | 5 | Recommendations by activity, kids' range, water resistance, size conversion from a table |
| orders | 7 | Verified lookups in different spellings, vague "where's my package", how to find an order ID |
| privacy | 3 | Someone else's order, asking for an address, asking by name |
| actions | 6 | Refund, money back, cancel, address change, exchange, late-return exception |
| people | 3 | Asking for a human in different words |
| upset | 3 | Anger, chargeback, legal threat |
| unsafe | 4 | Medical questions, rule-breaking and prompt-extraction attempts |
| conversation | 4 | Greeting, thanks, two questions in one message, gibberish |
| followups | 3 | "and for exchanges?", step-by-step verification, "when will it arrive?" after verification |

## Results

| Run | Passed | Failures |
| --- | --- | --- |
| [First run](runs/scenarios-first-run.txt) | 50 / 52 | "What time is support open?" got the shipping page (the support page never said "open"). "I ordered last week and nothing has come" wasn't treated as an order question (D-10). |
| [Final](runs/scenarios-final.txt) | 52 / 52 | |

Both failures were fixed generally (customer vocabulary on the source page, and a broader delivery-delay pattern), not by matching the two sentences.
