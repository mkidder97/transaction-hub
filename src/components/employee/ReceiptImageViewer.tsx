import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ZoomIn, ZoomOut, RotateCw, Loader2, Type, DollarSign, Check } from "lucide-react";
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";
import Tesseract from "tesseract.js";

/* ────────────────────────────── types ────────────────────────────── */

interface WordBox {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface Props {
  src: string;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVendorSelect?: (vendor: string) => void;
  onAmountSelect?: (amount: string) => void;
}

type SelectionMode = "vendor" | "amount" | null;

const AMOUNT_RE = /^\$?[\d,]+\.\d{2}$/;

/* ────────────────────── zoom toolbar (inside wrapper) ────────────── */

const ZoomToolbar = ({
  scale,
  onRotate,
  onClose,
}: {
  scale: number;
  onRotate: () => void;
  onClose: () => void;
}) => {
  const { zoomIn, zoomOut } = useControls();
  return (
    <div className="absolute top-3 right-3 z-50 flex gap-1.5">
      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={() => zoomIn()}>
        <ZoomIn className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={() => zoomOut()}>
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={onRotate}>
        <RotateCw className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={onClose}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

/* ────────────────────── main component ───────────────────────────── */

const ReceiptImageViewer = ({
  src,
  alt = "Receipt",
  open,
  onOpenChange,
  onVendorSelect,
  onAmountSelect,
}: Props) => {
  const [rotation, setRotation] = useState(0);
  const scaleRef = useRef(1);
  const [scaleDisplay, setScaleDisplay] = useState(100);
  const rafRef = useRef(0);

  // OCR state
  const [words, setWords] = useState<WordBox[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Image dimensions
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Selection state
  const [mode, setMode] = useState<SelectionMode>(null);
  const [vendorWordIndices, setVendorWordIndices] = useState<Set<number>>(new Set());
  const [amountWordIndex, setAmountWordIndex] = useState<number | null>(null);

  // Tap detection
  const pointerDownTime = useRef(0);
  const pointerDownPos = useRef({ x: 0, y: 0 });

  /* ── Reset on open ──────────────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setRotation(0);
      setScale(1);
      setWords([]);
      setOcrLoading(false);
      setMode(null);
      setVendorWordIndices(new Set());
      setAmountWordIndex(null);
      setNaturalSize({ w: 0, h: 0 });
      setDisplaySize({ w: 0, h: 0 });
    }
  }, [open]);

  /* ── Run OCR when dialog opens ──────────────────────────────────── */
  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;

    const runOcr = async () => {
      setOcrLoading(true);
      try {
        const result = await Tesseract.recognize(src, "eng", {
          tessedit_pageseg_mode: "6",
        } as any);

        if (cancelled) return;

        // tesseract.js exposes words at runtime; cast to bypass strict types
        const rawWords: any[] = (result.data as any).words ?? [];
        const wordBoxes: WordBox[] = rawWords
          .filter((w) => w.text?.trim().length > 0)
          .map((w) => ({
            text: w.text.trim(),
            bbox: w.bbox,
          }));

        setWords(wordBoxes);
      } catch (err) {
        console.error("OCR failed in lightbox:", err);
      } finally {
        if (!cancelled) setOcrLoading(false);
      }
    };

    runOcr();
    return () => { cancelled = true; };
  }, [open, src]);

  /* ── Track displayed image size via ResizeObserver ───────────────── */
  const attachObserver = useCallback((el: HTMLImageElement | null) => {
    // Clean up previous
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!el) return;
    imgRef.current = el;

    const update = () => {
      setDisplaySize({ w: el.offsetWidth, h: el.offsetHeight });
    };

    observerRef.current = new ResizeObserver(update);
    observerRef.current.observe(el);
    update();
  }, []);

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setDisplaySize({ w: img.offsetWidth, h: img.offsetHeight });
  }, []);

  /* ── Tap detection on word boxes ─────────────────────────────────── */
  const handleWordPointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownTime.current = Date.now();
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleWordPointerUp = useCallback(
    (e: React.PointerEvent, index: number) => {
      const elapsed = Date.now() - pointerDownTime.current;
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);

      // Only treat as tap if < 200ms and < 5px movement
      if (elapsed > 200 || dx > 5 || dy > 5) return;
      if (!mode) return;

      e.stopPropagation();

      const word = words[index];
      if (!word) return;

      if (mode === "vendor") {
        setVendorWordIndices((prev) => {
          const next = new Set(prev);
          if (next.has(index)) next.delete(index);
          else next.add(index);

          // Build vendor string from selected words in order
          const selectedText = Array.from(next)
            .sort((a, b) => a - b)
            .map((i) => words[i].text)
            .join(" ");
          onVendorSelect?.(selectedText);
          return next;
        });
      } else if (mode === "amount") {
        setAmountWordIndex(index);
        let val = word.text;
        if (AMOUNT_RE.test(val)) {
          val = val.replace(/[$,]/g, "");
        }
        onAmountSelect?.(val);
      }
    },
    [mode, words, onVendorSelect, onAmountSelect],
  );

  /* ── Render ─────────────────────────────────────────────────────── */
  const hasSelection = onVendorSelect || onAmountSelect;
  const canOverlay = naturalSize.w > 0 && displaySize.w > 0 && words.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-background/95 backdrop-blur-sm border-none [&>button]:hidden">
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={5}
          onTransformed={(_, state) => setScale(state.scale)}
          panning={{ disabled: false }}
          doubleClick={{ disabled: true }}
        >
          {/* Top toolbar */}
          <ZoomToolbar
            scale={scale}
            onRotate={() => setRotation((r) => r + 90)}
            onClose={() => onOpenChange(false)}
          />

          {/* Zoom percentage */}
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
            {Math.round(scale * 100)}%
          </div>

          {/* OCR loading indicator */}
          {ocrLoading && (
            <div className="absolute top-3 left-3 z-50 flex items-center gap-2 bg-background/80 px-3 py-1.5 rounded text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning text…
            </div>
          )}

          {/* Image area */}
          <TransformComponent
            wrapperStyle={{ width: "100%", height: "100%" }}
            contentStyle={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}
          >
            <div className="relative inline-block" style={{ transform: `rotate(${rotation}deg)`, transition: "transform 0.2s ease-out" }}>
              <img
                ref={attachObserver}
                src={src}
                alt={alt}
                draggable={false}
                onLoad={handleImageLoad}
                className="max-w-full max-h-[80vh] select-none"
              />

              {/* Word overlay boxes */}
              {canOverlay &&
                words.map((word, idx) => {
                  const scaleX = displaySize.w / naturalSize.w;
                  const scaleY = displaySize.h / naturalSize.h;

                  const left = word.bbox.x0 * scaleX;
                  const top = word.bbox.y0 * scaleY;
                  const width = (word.bbox.x1 - word.bbox.x0) * scaleX;
                  const height = (word.bbox.y1 - word.bbox.y0) * scaleY;

                  const isVendorSelected = vendorWordIndices.has(idx);
                  const isAmountSelected = amountWordIndex === idx;
                  const isSelected = isVendorSelected || isAmountSelected;

                  let bgClass = "bg-primary/[0.08]";
                  let borderClass = "border-transparent";

                  if (isVendorSelected) {
                    bgClass = "bg-blue-500/[0.35]";
                    borderClass = "border-blue-500/60";
                  } else if (isAmountSelected) {
                    bgClass = "bg-green-500/[0.35]";
                    borderClass = "border-green-500/60";
                  }

                  return (
                    <div
                      key={idx}
                      className={`absolute border rounded-sm cursor-pointer transition-colors ${bgClass} ${borderClass} ${
                        mode && !isSelected ? "hover:bg-primary/[0.25]" : ""
                      } ${!mode ? "pointer-events-none" : ""}`}
                      style={{
                        left: `${left}px`,
                        top: `${top}px`,
                        width: `${width}px`,
                        height: `${height}px`,
                      }}
                      onPointerDown={handleWordPointerDown}
                      onPointerUp={(e) => handleWordPointerUp(e, idx)}
                    />
                  );
                })}
            </div>
          </TransformComponent>

          {/* Bottom toolbar */}
          {hasSelection && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-lg border border-border">
              <Button
                size="sm"
                variant={mode === "vendor" ? "default" : "outline"}
                className={`gap-1.5 h-8 text-xs ${mode === "vendor" ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}`}
                onClick={() => setMode(mode === "vendor" ? null : "vendor")}
              >
                <Type className="h-3.5 w-3.5" /> Set Vendor
              </Button>
              <Button
                size="sm"
                variant={mode === "amount" ? "default" : "outline"}
                className={`gap-1.5 h-8 text-xs ${mode === "amount" ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                onClick={() => setMode(mode === "amount" ? null : "amount")}
              >
                <DollarSign className="h-3.5 w-3.5" /> Set Amount
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5 h-8 text-xs"
                onClick={() => onOpenChange(false)}
              >
                <Check className="h-3.5 w-3.5" /> Done
              </Button>
            </div>
          )}
        </TransformWrapper>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiptImageViewer;
