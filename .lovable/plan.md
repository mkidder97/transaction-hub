

## Interactive OCR Selection Layer with react-zoom-pan-pinch

### Dependencies
Install `react-zoom-pan-pinch` and `@use-gesture/react`.

### File Changes

**1. `src/components/employee/ReceiptImageViewer.tsx` -- full rewrite**

New props:
```ts
interface Props {
  src: string;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVendorSelect?: (vendor: string) => void;
  onAmountSelect?: (amount: string) => void;
}
```

Structure:
- Replace all manual zoom/pan/pinch logic with `<TransformWrapper>` + `<TransformComponent>` from react-zoom-pan-pinch
- Inside TransformComponent, render a `position: relative` wrapper containing:
  - The `<img>` element
  - Word overlay `<div>`s absolutely positioned over the image
- On dialog open, run `Tesseract.recognize(src, "eng", { tessedit_pageseg_mode: "6" })` in background to get `result.data.words` with bounding boxes
- Track image natural dimensions via `img.onLoad` (`e.target.naturalWidth/Height`) and displayed dimensions via `useRef` + `ResizeObserver` on the img element

Word overlay positioning (the key requirement):
```
left   = (word.bbox.x0 / naturalWidth)  * displayedWidth
top    = (word.bbox.y0 / naturalHeight) * displayedHeight
width  = ((word.bbox.x1 - word.bbox.x0) / naturalWidth)  * displayedWidth
height = ((word.bbox.y1 - word.bbox.y0) / naturalHeight) * displayedHeight
```
Since overlays are inside TransformComponent alongside the image, they zoom/pan automatically -- no need to manually track scale/positionX/positionY for overlay repositioning.

Gesture handling with `@use-gesture/react`:
- Attach `useDrag` to each word overlay box
- If gesture duration < 200ms and movement < 5px, treat as tap (word selection)
- Otherwise, let the event propagate for panning

Selection modes:
- State: `mode: "vendor" | "amount" | null`, `selectedVendorWords: Set<number>`, `selectedAmountWord: number | null`
- Bottom toolbar: "Set Vendor" (blue highlight when active), "Set Amount" (green), "Done" button
- Tapping a word in vendor mode toggles it in the set; joined text calls `onVendorSelect`
- Tapping a word in amount mode: if matches `\$?[\d,]+\.\d{2}`, strip `$` and commas, call `onAmountSelect`; otherwise fill as-is
- Word box styling: `opacity: 0.15` default, `0.35` hover, `0.5` selected; blue border for vendor, green for amount

Top toolbar: keep zoom in/out, rotate, close buttons using TransformWrapper's `zoomIn`/`zoomOut` refs. Show zoom percentage from transform state.

Loading state: spinner overlay while Tesseract runs; word boxes appear when ready.

**2. `src/pages/employee/SubmitReceipt.tsx` -- minor edits**

- Change `lightboxSrc` to also track the active item ID: `const [lightboxItem, setLightboxItem] = useState<{src: string; id: string} | null>(null)`
- Thumbnail click sets both src and item ID
- Pass callbacks to ReceiptImageViewer:
  - `onVendorSelect={(v) => updateItem(lightboxItem.id, { vendor: v })}`
  - `onAmountSelect={(a) => updateItem(lightboxItem.id, { amount: a })}`

### Files
| File | Action |
|------|--------|
| `package.json` | Add react-zoom-pan-pinch, @use-gesture/react |
| `src/components/employee/ReceiptImageViewer.tsx` | Full rewrite |
| `src/pages/employee/SubmitReceipt.tsx` | Track active item ID, pass selection callbacks |

