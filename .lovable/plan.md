

## Problem

The `openLightbox` function (line 319-343) fetches the signed URL as a blob via `fetch(signedUrl)`, which fails due to CORS restrictions on Supabase storage. This causes blank previews on click across all tabs. The thumbnails themselves render fine for non-placeholder receipts (using `useSignedUrl` hook directly as an `<img src>`), but placeholder thumbnails show a static FileText icon instead of an image preview.

Both All Receipts and Matched tabs use the identical `ReceiptThumb` component and `openLightbox` function, so the fix applies to both.

## Fix (single file: `src/pages/admin/Matching.tsx`)

### 1. Replace blob pipeline with direct signed URL
Remove: `lightboxObjectUrl`, `lightboxMime`, `lightboxError`, `lightboxLoading`, `lightboxObjectUrlRef`, `cleanupLightbox`.

Replace with two simple states:
- `lightboxUrl: string | null` — the signed URL
- `lightboxIsPdf: boolean` — detected from `storagePath.endsWith(".pdf")`

New `openLightbox`:
```typescript
const openLightbox = useCallback(async (storagePath: string) => {
  const isPdf = storagePath.toLowerCase().endsWith(".pdf");
  setLightboxIsPdf(isPdf);
  const url = await getSignedReceiptUrl(storagePath);
  setLightboxUrl(url);
}, []);
```

### 2. Update lightbox Dialog rendering
- For images: `<img src={lightboxUrl}>` (direct signed URL — this is what works for thumbnails already)
- For PDFs: `<object data={lightboxUrl} type="application/pdf">` with fallback "Open in new tab" / "Download" buttons so there's never a blank dead-end

### 3. No changes to ReceiptThumb or other components
The thumbnail component, data fetching, and tab rendering all stay exactly as they are. Only the lightbox open/render logic changes.

