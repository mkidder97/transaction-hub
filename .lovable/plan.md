

## Problem Analysis

The screenshot shows multiple "Load failed" errors on receipt uploads. The network logs confirm every storage POST is failing. Root causes:

1. **All files upload simultaneously** -- concurrency of 3 workers uploading large phone photos (often 3-10MB each) over mobile saturates the connection
2. **No retry logic** -- a single network hiccup kills the upload permanently
3. **No image compression** -- raw phone photos are massive; they don't need to be full resolution for receipt storage
4. **OCR runs on full-res blob URL** -- Tesseract processing multi-MB images on mobile is extremely slow

## Plan

### 1. Add client-side image compression before upload
In `processFile` in `src/pages/employee/SubmitReceipt.tsx`:
- Use an HTML Canvas to resize photos to max 1200px on the longest side before uploading
- This will reduce file sizes from ~5-10MB to ~200-500KB
- Create a helper function `compressImage(file: File, maxDim: number): Promise<Blob>`
- Use the compressed blob for both the storage upload AND OCR input

### 2. Reduce concurrency to 1 worker
Change the worker count from `Math.min(3, queue.length)` to `1` so files process sequentially. This prevents saturating the mobile connection.

### 3. Add retry logic on upload failure
Wrap the storage upload in a retry loop (up to 3 attempts with 1s delay between). If all retries fail, mark as error.

### 4. Show file size in status
Display the compressed file size next to the filename so users can see the optimization working.

### Technical Details

**New helper function** (added at top of `SubmitReceipt.tsx`):
```typescript
async function compressImage(file: File