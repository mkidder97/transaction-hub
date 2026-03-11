

## Improve Receipt OCR Accuracy — Client-Side Only

### Changes to `src/lib/ocr.ts`

**1. Add `preprocessImage(imageUrl)` function**
- Load image onto canvas
- Convert to grayscale (weighted luminance)
- Boost contrast by ~40% using linear stretch from midpoint
- Apply convolution-based sharpening kernel
- Scale up to 1500px minimum on longest side
- Return as data URL

**2. Update Tesseract config in `runOcrRaw`**
- Set `tessedit_pageseg_mode: "4"` (single column)
- Set `preserve_interword_spaces: "1"`
- Call `preprocessImage` before passing to Tesseract

**3. Rewrite `extractAmount`**
- First pass: find lines with "total", "amount due", "balance due", "grand total" and extract dollar amounts from those lines
- Second pass: if no labeled total found, collect all dollar amounts and pick the largest
- Filter out likely quantity values (amounts under $1 or matching quantity patterns)

**4. Rewrite `extractVendor`**
- Skip lines that look like addresses (digits + ST/AVE/RD/BLVD), dates, or noise words ("receipt", "welcome", "thank you", "customer copy", "store #", "tel", "phone")
- Prefer all-caps lines between 3-30 chars
- Fall back to first non-skipped line

**5. Improve `extractDate`**
- Add patterns for "03/10/26", "Mar. 10", and other short formats
- Prefer dates near labels like "date:", "transaction date", "visit"
- Fall back to any valid date found

### Files
- `src/lib/ocr.ts` — all changes in this single file

All existing exports (`runOcr`, `runOcrRaw`, `parseTransactionList`, `parseTransactionRows`, `OcrResult`, `ParsedTransaction`, `ParsedTransactionRow`) remain unchanged in signature.

