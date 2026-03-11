

## Root Cause

The infinite loop is caused by line 230: `onTransformed={(_, state) => setScale(state.scale)}`. This sets React state on every transform event, which re-renders the component, which causes `TransformWrapper` to re-fire `onTransformed`, creating an infinite update cycle.

## Fix

**File: `src/components/employee/ReceiptImageViewer.tsx`**

1. Replace `scale` state with a ref (`scaleRef`) to avoid re-renders
2. Add a separate `scaleDisplay` state that updates only via `requestAnimationFrame` to debounce the zoom percentage display
3. Change `onTransformed` to write to the ref and schedule a RAF update for the display value
4. Pass `scaleRef.current` to `ZoomToolbar` (toolbar doesn't actually use scale for rendering, only the zoom percentage `<div>` does)

The key change:
```ts
// Before (causes infinite loop)
const [scale, setScale] = useState(1);
onTransformed={(_, state) => setScale(state.scale)}

// After (ref + debounced display)
const scaleRef = useRef(1);
const [scaleDisplay, setScaleDisplay] = useState(100);
const rafRef = useRef(0);

onTransformed={(_, state) => {
  scaleRef.current = state.scale;
  cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    setScaleDisplay(Math.round(state.scale * 100));
  });
}}
```

Update the zoom percentage div to use `scaleDisplay` instead of `Math.round(scale * 100)`.

Single file edit, ~10 lines changed.

