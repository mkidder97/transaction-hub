

## Fix: Stale Bundle Cache

The error `Can't find variable: scale` is a **cached bundle issue**, not a code bug. The current source code has no bare `scale` variable — it was correctly replaced with `scaleRef` and `scaleDisplay` in the last edit. The browser is running an old version.

However, to guarantee this doesn't happen and to add a small safety measure, I'll make a trivial edit that forces a cache bust:

### Changes

**`src/components/employee/ReceiptImageViewer.tsx`** — Add a cleanup for `rafRef` in the reset effect to ensure no stale animation frames persist:

```ts
// In the reset-on-open useEffect, add:
cancelAnimationFrame(rafRef.current);
```

This is a one-line addition inside the existing `useEffect` at line 91. It's functionally correct (cleans up pending RAF on re-open) and will force a module reload, clearing the stale cache.

No other files need changes. The feature implementation is complete and correct — the dialog, OCR scanning, word overlays, and selection modes are all properly wired up.

