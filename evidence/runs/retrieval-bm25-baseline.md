# Retrieval benchmark (BM25)

2026-10-04T10:43:12.409Z · 41 labelled questions · 21 KB pages

| Metric | Value |
| --- | --- |
| hit@1 | 73.2% |
| hit@3 | 82.9% |
| hit@3, direct wording | 95% |
| hit@3, paraphrased | 71.4% |

## Misses

| Question | Style | Expected | Got (top 3 above threshold) |
| --- | --- | --- | --- |
| How many days do I have to send shoes back? | paraphrase | kb-returns-001 | kb-intl-019, kb-damaged-016, kb-exchange-002 |
| Can I get my money back if I don't like them? | paraphrase | kb-returns-001 | kb-intl-019, kb-loyalty-018, kb-giftcard-017 |
| I wore them twice, can they still go back? | paraphrase | kb-worn-003 | kb-care-007, kb-intl-019, kb-worn-003 (rank 3) |
| How long does shipping take to Bandung? | direct | kb-shipping-004 | kb-intl-019, kb-stores-020, kb-shipping-004 (rank 3) |
| When will a parcel reach Surabaya after it leaves? | paraphrase | kb-shipping-004 | kb-carriers-005, kb-stores-020, kb-shipping-004 (rank 3) |
| Can I stack discount codes? | paraphrase | kb-promo-009 | kb-giftcard-017, kb-promo-009, kb-loyalty-018 (rank 2) |
| I ordered something not released yet, when does it come? | paraphrase | kb-preorder-011 | kb-intl-019, kb-giftcard-017 |
| Which shoes do you sell? | direct | kb-products-014 | kb-worn-003, kb-fit-015 |
| I'm on my feet at work, what should I buy? | paraphrase | kb-fit-015 | kb-contact-012 |
| I want to give Tapak credit as a present | paraphrase | kb-giftcard-017 | kb-warranty-008, kb-orders-021, kb-payment-010 |
| Can I try them on somewhere before buying? | paraphrase | kb-stores-020 | kb-care-007, kb-worn-003, kb-giftcard-017 |
