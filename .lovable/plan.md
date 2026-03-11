

## Receipt Matching: Research Findings and Creative Solutions

### What the industry does

Research into Brex, Expensify, Navan, Dext, and Emburse reveals a consistent pattern:

- **Nobody uses client-side OCR.** Expensify's SmartScan sends images server-side. Brex auto-generates receipt data from merchant feeds. Dext uses cloud AI extraction.
- **Brex auto-matches** by comparing receipt date + amount + merchant against card transactions — no manual intervention needed.
- **Expensify** lets users snap a photo and walk away — SmartScan extracts data server-side, then auto-attaches to the right card transaction.
- **The UX pattern everywhere**: snap photo → AI extracts data in background → auto-match to transaction → employee only intervenes on mismatches.

### The core problem in your app

You're running **Tesseract.js in the browser** — a general-purpose OCR engine that's slow (~10-15s), inaccurate on phone photos, and requires complex client-side preprocessing. Meanwhile, you already have `LOVABLE_API_KEY` configured, giving you access to **Gemini vision models** that can extract structured receipt data in 1-2 seconds with far higher accuracy.

### Proposed approach: Three-layer system

**Layer 1 — AI Vision extraction (replaces Tesseract.js)**
- New edge function `extract-receipt` that receives the receipt image URL
- Calls Gemini Flash with the image + a tool-calling schema to extract `{vendor, amount, date}` as structured output
- Returns results in ~1-2 seconds with high accuracy
- No client-side OCR, no word overlays, no bounding boxes

**Layer 2 — Auto-match on submission**
- When a receipt is submitted, automatically run matching against unmatched transactions for that user (by `card_last_four`)
- Score by amount (exact match = high), date (within 3 days = boost), vendor similarity
- If score >= 0.8: auto-link receipt to transaction, mark both as `matched`
- If score 0.5-0.8: suggest the match, let employee confirm
- If no match: receipt stays unmatched for admin review

**Layer 3 — Transaction-first flow (new, parallel path)**
- On the employee Transactions page, add an "Attach Receipt" button on unmatched rows
- Tapping it opens camera/file picker → uploads photo → links directly to that transaction
- No OCR needed at all — vendor/amount/date come from the transaction
- This handles the "I see the transaction, let me attach proof" use case

### What changes

**New edge function: `supabase/functions/extract-receipt/index.ts`**
- Accepts `{ imageUrl: string }`
- Calls Gemini Flash vision with tool calling to extract `{ vendor, amount, date }`
- Returns structured data in ~1-2s

**Modify: `src/pages/employee/SubmitReceipt.tsx`**
- Replace `runOcr()` call with edge function invocation
- Remove Tesseract progress bar (extraction is fast enough for a spinner)
- After submission, call matching logic automatically

**Simplify: `src/components/employee/ReceiptImageViewer.tsx`**
- Remove all Tesseract/word-overlay/selection code (~300 lines deleted)
- Keep only: zoom, pan, rotate as a reference viewer
- Remove `onVendorSelect` / `onAmountSelect` props

**Modify: `src/pages/employee/Transactions.tsx`**
- Add "Attach Receipt" button on unmatched transaction rows
- Opens camera/file picker inline
- On photo capture: compress, upload, create receipt linked to transaction

**Modify: `src/lib/matcher.ts`**
- Enhance scoring with vendor name similarity (fuzzy match)
- Call automatically after receipt submission

**Remove dependency: `tesseract.js`**
- No longer needed — saves ~2MB from bundle

### Why this is better

| Current | Proposed |
|---------|----------|
| Tesseract.js: 10-15s, low accuracy | Gemini Vision: 1-2s, high accuracy |
| Complex word overlay UX (broken) | Simple form with AI-populated fields |
| Manual matching only | Auto-match on submission |
| One workflow: upload then match | Two workflows: submit receipt OR attach to transaction |
| ~2MB client-side OCR library | Zero client-side AI dependencies |

