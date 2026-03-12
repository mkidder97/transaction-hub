

# Duplicate Receipt Detection + Signed URLs (8 Steps)

## Step 1 — Migration
Add `duplicate_status` (TEXT, CHECK: `suspected/confirmed_duplicate/not_duplicate`) and `duplicate_of_id` (UUID FK → receipts) to `receipts` table.

## Step 2 — Create `src/lib/duplicateDetector.ts`
Client-side duplicate detection: bigram vendor similarity, amount/date/employee matching. Returns `DuplicateGroup[]` with confidence (high/medium). Includes `storage_path` in query and interface.

## Step 3 — Create `src/lib/getSignedReceiptUrl.ts`
In-memory cached signed URL generator for `receipts` bucket. 1-hour TTL, refreshes 5 min before expiry.

## Step 4 — Create `src/hooks/useSignedUrl.ts`
React hook wrapping the generator with state and cleanup.

## Step 5 — Update `src/pages/admin/Matching.tsx`
- Add `storage_path` to `ReceiptRow` and all `select()` queries
- Replace `ReceiptThumb` to use `useSignedUrl(storagePath)` internally
- Add `ReviewCardThumb` for needs-review tab using signed URLs
- Update all call sites: `storagePath={r.storage_path}`
- Add duplicates tab: state, `fetchDuplicates` wired into `refreshAll`/`useEffect`, `confirmDuplicate`/`dismissDuplicate` handlers, 6th stat card, grid-cols-6, tab trigger + content with side-by-side cards, confidence badges, action buttons

## Step 6 — No sidebar changes

## Step 7 — Fix `src/pages/employee/Receipts.tsx`
- Create `ReceiptListThumb` using `useSignedUrl(storagePath)`
- Replace `{r.photo_url ? <img> : <placeholder>}` with `<ReceiptListThumb storagePath={r.storage_path} />`

## Step 8 — Fix `src/components/employee/ReceiptDetailPanel.tsx`
- Add `storage_path: string | null` to `ReceiptRow` interface
- Call `useSignedUrl` **before** the early return guard to respect rules of hooks:
```tsx
export function ReceiptDetailPanel({ receipt, onClose }) {
  const signedUrl = useSignedUrl(receipt?.storage_path ?? null);
  if (!receipt) return null;
  // use signedUrl instead of r.photo_url in the image block
}
```
- Replace `r.photo_url` in the image render with `signedUrl`, keep `photo_url` fallback logic removed since signed URL handles it

