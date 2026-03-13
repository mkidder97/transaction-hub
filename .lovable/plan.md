

# Create Receipt Review PDF Generator

## New file: `src/lib/generateReceiptReviewPdf.ts`

Creates a one-receipt-per-page image-forward PDF with metadata header, receipt image (or placeholder), and footer. Uses the same blob/window.open delivery pattern as `generateReconciliationPdf.ts`.

Key implementation details:
- Named import `{ jsPDF }` from `jspdf`
- Portrait A4 (210x297mm)
- Header strip (0-22mm): employee name, vendor, amount, date, match status on gray background
- Image area (22-285mm): fetches signed URL via `getSignedReceiptUrl`, converts to base64, scales to fit 190x250mm maintaining aspect ratio. Placeholder receipts get a gray box with transaction details.
- Footer (285-297mm): page counter left, category right
- Downloads via `window.open` with anchor fallback

## Edit: `src/pages/admin/Receipts.tsx`

- Add imports: `generateReceiptReviewPdf`, `FileText` and `Loader2` from lucide-react
- Add `generating` state boolean
- Add "Receipt Review PDF" button next to existing CSV button, disabled when `receipts.length === 0` or generating, with Loader2 spinner during generation
- On click: calls `generateReceiptReviewPdf(periodId)`, catches errors with `toast.error`

