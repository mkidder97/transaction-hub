

# Add date proximity guard to medium-confidence duplicate detection

## What changes

**Single file: `src/lib/duplicateDetector.ts`**

1. Add a `dateDiffDays` helper function (after `vendorSimilarity`) that returns the absolute difference in days between two date strings, or `Infinity` if either is null/invalid.

2. Inside the inner loop of `detectDuplicatesForPeriod`, compute `daysApart` and `datesProximate` (≤3 days) after the existing `vendorMatch` computation.

3. Update the third confidence rule from `amountMatch && vendorMatch && sameEmployee` to `amountMatch && vendorMatch && sameEmployee && datesProximate`.

No other files change. High-confidence matches (exact date + amount + vendor) are unaffected. This only tightens the rule that currently flags recurring same-vendor purchases (e.g. weekly lunches) as false positives.

