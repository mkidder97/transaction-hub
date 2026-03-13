

# Checkbox Selection + ZIP Download for Admin Receipts

## Single file change: `src/pages/admin/Receipts.tsx`

### 1. Data changes
- Add `storage_path` to `ReceiptRow` interface and the `.select()` query string

### 2. New state
- `selected: Set<string>` — reset in `fetchReceipts`
- `zipping: boolean`

### 3. Checkbox column
- Select-all checkbox in `TableHeader`
- Per-row checkbox in each `TableRow`

### 4. Selection action bar
Shown between filters and table when `selected.size > 0` — displays count, "Download ZIP" button, and "Clear" button.

### 5. ZIP download logic
- Import `JSZip`, `getSignedReceiptUrl`, `Archive`, `Checkbox`
- For each selected receipt: call `getSignedReceiptUrl(receipt.storage_path)` — if `storage_path` is null or signed URL returns null, **skip silently**
- Fetch blob from signed URL, add to ZIP with descriptive filename (`employee_vendor_date.ext`)
- Download as `receipts-{periodName}.zip`
- Never use `photo_url` for fetching images

### Install
`bun add jszip`

