
Issue recap:
- You’re right: this is a regression loop.
- The placeholder PDFs exist in storage and are uploaded with correct `application/pdf` metadata, so this is not missing data.
- The break is in `src/pages/admin/Matching.tsx` preview logic:
  1) placeholder thumbnail rendering was changed to a static icon (so you lost the small visual preview),
  2) placeholder open now relies on iframe + signed URL rendering, which is causing blank previews in your environment.
- Because All Receipts and Matched both use the same `ReceiptThumb` + lightbox code, both tabs are affected.

Do I know what the issue is?
- Yes.

Plan to fix (single pass, no more toggling behavior):
1. Rework preview open flow to use `storage_path` as the source of truth (not a precomputed URL string).
   - Update `ReceiptThumb`/`ReviewCardThumb` click handlers to pass `storagePath` to `openLightbox`.
   - In `openLightbox`, fetch a fresh signed URL at click time (prevents stale/bad URL behavior).

2. Build a robust lightbox loader with explicit file-type handling.
   - On open: resolve signed URL -> fetch blob -> detect mime (`blob.type`, fallback from extension).
   - Render from `blob:` object URL in dialog instead of embedding the remote signed URL directly.
   - This avoids blank inline previews caused by direct remote embed behavior.
   - Add loading and error states in the modal.

3. Restore thumbnail behavior for placeholders.
   - Try to render thumbnail as `<img src={signedUrl}>` (so small preview returns where supported).
   - Add `onError` fallback to a PDF icon tile (instead of hard-forcing icon always).
   - Keep click behavior consistent regardless of thumbnail fallback.

4. Add non-broken fallback actions in modal.
   - If inline PDF still fails in browser: show “Open” and “Download” actions using the resolved blob/signed URL.
   - This prevents blank dead-end states and avoids dumping users into raw backend URLs unexpectedly.

5. Keep scope isolated to one file path first.
   - Primary file: `src/pages/admin/Matching.tsx`.
   - Reuse existing signing utility (`src/lib/getSignedReceiptUrl.ts`) without backend/schema changes.

Technical details (implementation-focused):
- Replace current `lightboxUrl + lightboxIsPdf` with a structured state:
  - `open`, `storagePath`, `signedUrl`, `objectUrl`, `mime`, `loading`, `error`.
- Ensure `URL.revokeObjectURL` runs when modal closes/unmounts.
- Update all callsites in Matching tabs:
  - All Receipts
  - Matched
  - Needs Review thumbnail entry points
  - Duplicate cards (if applicable)
- Keep existing security model (private bucket + signed URLs) unchanged.

Validation checklist after implementation:
1) `/admin/matching?tab=all`: click placeholder row thumbnail -> inline preview loads, not blank.
2) `/admin/matching?tab=matched`: same for placeholder and normal image receipts.
3) Normal image receipts still preview correctly in dialog.
4) If inline viewer fails, fallback open/download works (no dead blank modal).
5) No forced navigation to raw storage URL on click.
