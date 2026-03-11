

## Fix word tap selection in ReceiptImageViewer

Three bugs prevent word box taps from working. All fixes are in `src/components/employee/ReceiptImageViewer.tsx`.

### Bug 1 — Pointer capture steals word box events (main culprit)
The outer pan div calls `setPointerCapture()` on pointerdown, which redirects ALL subsequent pointer events to it — word box `onPointerUp` never fires.

**Fix:** Add `e.stopPropagation()` to `handleWordPointerDown` (line 183) so the outer div's `handlePointerDown` doesn't run when tapping a word box.

### Bug 2 — Calling onVendorSelect inside state updater
`onVendorSelect` is called inside `setVendorWordIndices` updater function (line 212), which can cause update-during-render issues.

**Fix:** Replace the vendor block in `handleWordPointerUp` to compute the new set outside the updater, call `setVendorWordIndices(next)` and `onVendorSelect` sequentially. Add `vendorWordIndices` to the dependency array.

### Bug 3 — Display size is 0 during dialog animation
`handleImageLoad` captures `offsetWidth/offsetHeight` before the dialog finishes animating, yielding 0 values so overlay positions are wrong.

**Fix:** Add a `ResizeObserver` on the img element that updates `displaySizeRef` and sets `overlayReady` when the image has non-zero dimensions. Keyed on `words` so it re-attaches after OCR completes.

### Summary
- Single file edit, ~20 lines changed
- No new dependencies

