import { useState, useRef, useCallback, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, ZoomIn, ZoomOut, RotateCw } from "lucide-react";

interface Props {
  src: string;
  alt?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

const ReceiptImageViewer = ({ src, alt = "Receipt", open, onOpenChange }: Props) => {
  const [rotation, setRotation] = useState(0);
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const posAtPanStart = useRef({ x: 0, y: 0 });

  const applyTransform = useCallback(() => {
    if (!contentRef.current) return;
    const s = scaleRef.current;
    const { x, y } = posRef.current;
    contentRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }, []);

  useEffect(() => {
    if (open) {
      setRotation(0);
      scaleRef.current = 1;
      posRef.current = { x: 0, y: 0 };
    }
  }, [open]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scaleRef.current = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * delta));
    applyTransform();
  }, [applyTransform]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    posAtPanStart.current = { ...posRef.current };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    posRef.current = {
      x: posAtPanStart.current.x + (e.clientX - panStart.current.x),
      y: posAtPanStart.current.y + (e.clientY - panStart.current.y),
    };
    applyTransform();
  }, [applyTransform]);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const zoomIn = useCallback(() => {
    scaleRef.current = Math.min(MAX_SCALE, scaleRef.current * 1.3);
    applyTransform();
  }, [applyTransform]);

  const zoomOut = useCallback(() => {
    scaleRef.current = Math.max(MIN_SCALE, scaleRef.current / 1.3);
    applyTransform();
  }, [applyTransform]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-background/95 backdrop-blur-sm border-none [&>button]:hidden overflow-hidden">
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

        <div
          className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div ref={contentRef} className="will-change-transform" style={{ transformOrigin: "center center" }}>
            <div style={{ transform: `rotate(${rotation}deg)`, transition: "transform 0.2s ease-out" }}>
              <img
                src={src}
                alt={alt}
                draggable={false}
                className="max-w-full max-h-[80vh] select-none pointer-events-none"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiptImageViewer;
