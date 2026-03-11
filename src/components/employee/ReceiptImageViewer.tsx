import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ZoomIn, ZoomOut, RotateCw, Loader2, Type, DollarSign, Check } from "lucide-react";
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
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

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

  // Zoom/pan via refs + CSS transform (no React state to avoid re-render loops)
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  // Pan gesture tracking
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const posAtPanStart = useRef({ x: 0, y: 0 });

  // OCR state
  const [words, setWords] = useState<WordBox[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Image dimensions (tracked via refs to avoid re-render loops)
  const naturalSizeRef = useRef({ w: 0, h: 0 });
  const displaySizeRef = useRef({ w: 0, h: 0 });
  const [overlayReady, setOverlayReady] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Selection state
  const [mode, setMode] = useState<SelectionMode>(null);
  const [vendorWordIndices, setVendorWordIndices] = useState<Set<number>>(new Set());
  const [amountWordIndex, setAmountWordIndex] = useState<number | null>(null);

  // Tap detection
  const pointerDownTime = useRef(0);
  const pointerDownPos = useRef({ x: 0, y: 0 });

  /* ── Apply transform to DOM directly ────────────────────────────── */
  const applyTransform = useCallback(() => {
    if (!contentRef.current) return;
    const s = scaleRef.current;
    const { x, y } = posRef.current;
    contentRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }, []);

  /* ── Reset on open ──────────────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      setRotation(0);
      scaleRef.current = 1;
      posRef.current = { x: 0, y: 0 };
      setWords([]);
      setOcrLoading(false);
      setMode(null);
      setVendorWordIndices(new Set());
      setAmountWordIndex(null);
      naturalSizeRef.current = { w: 0, h: 0 };
      displaySizeRef.current = { w: 0, h: 0 };
      setOverlayReady(false);
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

        const rawWords: any[] = (result.data as any).words ?? [];
        const wordBoxes: WordBox[] = rawWords
          .filter((w: any) => w.text?.trim().length > 0)
          .map((w: any) => ({
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

  /* ── Image load ─────────────────────────────────────────────────── */
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    naturalSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
    displaySizeRef.current = { w: img.offsetWidth, h: img.offsetHeight };
    imgRef.current = img;
    setOverlayReady(true);
  }, []);

  /* ── Zoom via wheel ─────────────────────────────────────────────── */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * delta));
    applyTransform();
  }, [applyTransform]);

  /* ── Pan via pointer ────────────────────────────────────────────── */
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only pan with primary button and when not in selection mode or on the background
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    posAtPanStart.current = { ...posRef.current };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    posRef.current = {
      x: posAtPanStart.current.x + dx,
      y: posAtPanStart.current.y + dy,
    };
    applyTransform();
  }, [applyTransform]);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  /* ── Zoom buttons ───────────────────────────────────────────────── */
  const zoomIn = useCallback(() => {
    scaleRef.current = Math.min(MAX_SCALE, scaleRef.current * 1.3);
    applyTransform();
  }, [applyTransform]);

  const zoomOut = useCallback(() => {
    scaleRef.current = Math.max(MIN_SCALE, scaleRef.current / 1.3);
    applyTransform();
  }, [applyTransform]);

  /* ── Tap detection on word boxes ─────────────────────────────────── */
  const handleWordPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    pointerDownTime.current = Date.now();
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleWordPointerUp = useCallback(
    (e: React.PointerEvent, index: number) => {
      const elapsed = Date.now() - pointerDownTime.current;
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);

      if (elapsed > 200 || dx > 5 || dy > 5) return;
      if (!mode) return;

      e.stopPropagation();

      const word = words[index];
      if (!word) return;

      if (mode === "vendor") {
        const next = new Set(vendorWordIndices);
        if (next.has(index)) next.delete(index);
        else next.add(index);

        const selectedText = Array.from(next)
          .sort((a, b) => a - b)
          .map((i) => words[i].text)
          .join(" ");
        setVendorWordIndices(next);
        onVendorSelect?.(selectedText);
      } else if (mode === "amount") {
        setAmountWordIndex(index);
        let val = word.text;
        if (AMOUNT_RE.test(val)) {
          val = val.replace(/[$,]/g, "");
        }
        onAmountSelect?.(val);
      }
    },
    [mode, words, vendorWordIndices, onVendorSelect, onAmountSelect],
  );

  /* ── ResizeObserver for accurate display dimensions ──────────────── */
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => {
      displaySizeRef.current = { w: img.offsetWidth, h: img.offsetHeight };
    });
    ro.observe(img);
    return () => ro.disconnect();
  }, [words]);

  /* ── Render ─────────────────────────────────────────────────────── */
  const hasSelection = onVendorSelect || onAmountSelect;
  const ns = naturalSizeRef.current;
  const ds = displaySizeRef.current;
  const canOverlay = overlayReady && ns.w > 0 && ds.w > 0 && words.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-background/95 backdrop-blur-sm border-none [&>button]:hidden overflow-hidden">
        {/* Top toolbar */}
        <div className="absolute top-3 right-3 z-50 flex gap-1.5">
          <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={zoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={zoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={() => setRotation((r) => r + 90)}>
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* OCR loading indicator */}
        {ocrLoading && (
          <div className="absolute top-3 left-3 z-50 flex items-center gap-2 bg-background/80 px-3 py-1.5 rounded text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning text…
          </div>
        )}

        {/* Pannable / zoomable area */}
        <div
          className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            ref={contentRef}
            className="will-change-transform"
            style={{ transformOrigin: "center center" }}
          >
            <div
              className="relative inline-block"
              style={{ transform: `rotate(${rotation}deg)`, transition: "transform 0.2s ease-out" }}
            >
              <img
                ref={imgRef}
                src={src}
                alt={alt}
                draggable={false}
                onLoad={handleImageLoad}
                className="max-w-full max-h-[80vh] select-none pointer-events-none"
              />

              {/* Word overlay boxes */}
              {canOverlay &&
                words.map((word, idx) => {
                  const scaleX = ds.w / ns.w;
                  const scaleY = ds.h / ns.h;

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
          </div>
        </div>

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
      </DialogContent>
    </Dialog>
  );
};

export default ReceiptImageViewer;
