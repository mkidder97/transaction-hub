import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Camera,
  Upload,
  Loader2,
  ScanSearch,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { format } from "date-fns";
import { runOcr, type OcrResult } from "@/lib/ocr";
import { lookupVendor, submitVendorCandidate } from "@/lib/vendorLookup";
import ReceiptImageViewer from "@/components/employee/ReceiptImageViewer";

interface Category {
  id: string;
  name: string;
}

type ItemStatus = "uploading" | "ocr" | "ready" | "error" | "submitting" | "done";

interface ReceiptItem {
  id: string;
  file: File;
  previewUrl: string;
  compressedSize?: number;
  status: ItemStatus;
  errorMessage?: string;
  storagePath?: string;
  publicUrl?: string;
  ocrResult?: OcrResult;
  ocrProgress: number;
  vendor: string;
  amount: string;
  date: string;
  categoryId: string;
  notes: string;
}

async function compressImage(file: File, maxDim = 1200): Promise<Blob> {
  if (file.type === "application/pdf") return file;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Compression failed"))),
        "image/jpeg",
        0.8,
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error("Failed to load image")); };
    img.src = URL.createObjectURL(file);
  });
}

async function uploadWithRetry(
  storagePath: string,
  blob: Blob,
  contentType: string,
  retries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.storage
      .from("receipts")
      .upload(storagePath, blob, { contentType, upsert: false });
    if (!error) return;
    if (attempt === retries) throw error;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const MAX_FILES = 20;

const SubmitReceipt = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submittingAll, setSubmittingAll] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<{ src: string; id: string } | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from("expense_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setCategories(data);
      });
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<ReceiptItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const processFile = useCallback(
    async (item: ReceiptItem) => {
      if (!user) return;

      try {
        // Compress
        const compressed = await compressImage(item.file);
        const compressedUrl = URL.createObjectURL(compressed);
        updateItem(item.id, { compressedSize: compressed.size });

        // Upload with retry
        const monthFolder = format(new Date(), "yyyy-MM");
        const storagePath = `receipts/${user.id}/${monthFolder}/${uuidv4()}.jpg`;

        await uploadWithRetry(storagePath, compressed, "image/jpeg");

        const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(storagePath);
        updateItem(item.id, { storagePath, publicUrl: urlData.publicUrl, status: "ocr" });

        // OCR on compressed image
        const result = await runOcr(compressedUrl, (p) => {
          updateItem(item.id, { ocrProgress: p });
        });
        URL.revokeObjectURL(compressedUrl);

        // Vendor dictionary lookup
        let vendorName = result.vendor_extracted ?? "";
        let autoCategoryId = "";
        if (vendorName) {
          const match = await lookupVendor(vendorName);
          if (match) {
            vendorName = match.canonical_name;
            if (match.default_category_id) autoCategoryId = match.default_category_id;
          }
        }

        updateItem(item.id, {
          status: "ready",
          ocrResult: result,
          vendor: vendorName,
          amount: result.amount_extracted != null ? String(result.amount_extracted) : "",
          date: result.date_extracted ?? "",
          categoryId: autoCategoryId,
          ocrProgress: 1,
        });
      } catch (err: any) {
        updateItem(item.id, { status: "error", errorMessage: err.message ?? "Processing failed" });
      }
    },
    [user, updateItem],
  );

  const handleFilesSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !user) return;

      const fileArray = Array.from(files).slice(0, MAX_FILES);
      if (files.length > MAX_FILES) {
        toast.warning(`Only the first ${MAX_FILES} photos were added.`);
      }

      const newItems: ReceiptItem[] = fileArray.map((file) => ({
        id: uuidv4(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading" as ItemStatus,
        ocrProgress: 0,
        vendor: "",
        amount: "",
        date: "",
        categoryId: "",
        notes: "",
      }));

      setItems((prev) => [...prev, ...newItems]);

      // Process sequentially to avoid saturating mobile connections
      const queue = [...newItems];
      const workers = Array.from({ length: 1 }, async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) await processFile(next);
        }
      });
      await Promise.all(workers);

      // Reset input so the same files can be selected again
      e.target.value = "";
    },
    [user, processFile],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const handleSubmitAll = async () => {
    if (!user) return;
    const readyItems = items.filter((i) => i.status === "ready");
    if (readyItems.length === 0) {
      toast.error("No receipts ready to submit.");
      return;
    }

    setSubmittingAll(true);

    const rows = readyItems.map((item) => ({
      user_id: user.id,
      photo_url: item.publicUrl!,
      storage_path: item.storagePath!,
      vendor_extracted: item.ocrResult?.vendor_extracted ?? null,
      amount_extracted: item.ocrResult?.amount_extracted ?? null,
      date_extracted: item.ocrResult?.date_extracted ?? null,
      ai_raw_text: item.ocrResult?.ai_raw_text ?? null,
      ai_confidence: item.ocrResult?.ai_confidence ?? null,
      vendor_confirmed: item.vendor || null,
      amount_confirmed: item.amount ? parseFloat(item.amount) : null,
      date_confirmed: item.date || null,
      category_id: item.categoryId || null,
      notes: item.notes || null,
      status: "pending",
    }));

    try {
      const { error } = await supabase.from("receipts").insert(rows);
      if (error) throw error;

      // Submit vendor candidates for admin review
      if (user) {
        for (const item of readyItems) {
          const ocrVendor = item.ocrResult?.vendor_extracted;
          const confirmedVendor = item.vendor;
          if (ocrVendor && confirmedVendor && ocrVendor !== confirmedVendor) {
            await submitVendorCandidate(ocrVendor, confirmedVendor, item.categoryId || null, user.id);
          }
        }
      }

      // Mark all as done
      setItems((prev) =>
        prev.map((i) => (readyItems.some((r) => r.id === i.id) ? { ...i, status: "done" as ItemStatus } : i)),
      );
      toast.success(`${readyItems.length} receipt(s) submitted!`);
      setTimeout(() => navigate("/employee/receipts"), 1200);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit receipts");
    } finally {
      setSubmittingAll(false);
    }
  };

  const readyCount = items.filter((i) => i.status === "ready").length;
  const processingCount = items.filter((i) => i.status === "uploading" || i.status === "ocr").length;
  const doneCount = items.filter((i) => i.status === "done").length;

  const confidenceColor = (score: number) => {
    if (score > 0.8) return "bg-accent text-accent-foreground";
    if (score >= 0.5) return "bg-warning text-warning-foreground";
    return "bg-destructive text-destructive-foreground";
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Submit Receipts</h1>
        <p className="text-muted-foreground text-sm">
          Select up to {MAX_FILES} photos at once. Review extracted data, then submit all.
        </p>
      </div>

      {/* Upload buttons */}
      <div className="flex gap-3">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFilesSelect} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={handleFilesSelect} />
        <Button variant="outline" className="flex-1 h-12 gap-2" onClick={() => cameraRef.current?.click()} disabled={submittingAll}>
          <Camera className="h-5 w-5" /> Camera
        </Button>
        <Button variant="outline" className="flex-1 h-12 gap-2" onClick={() => fileRef.current?.click()} disabled={submittingAll}>
          <Upload className="h-5 w-5" /> Upload Photos
        </Button>
      </div>

      {/* Status summary */}
      {items.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">{items.length} photo(s)</span>
          {processingCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> {processingCount} processing
            </Badge>
          )}
          {readyCount > 0 && (
            <Badge className="bg-accent text-accent-foreground gap-1">
              <CheckCircle2 className="h-3 w-3" /> {readyCount} ready
            </Badge>
          )}
          {doneCount > 0 && (
            <Badge variant="outline" className="gap-1">
              {doneCount} submitted
            </Badge>
          )}
        </div>
      )}

      {/* Receipt queue */}
      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            <CardContent className="p-3 space-y-3">
              {/* Header row: thumbnail + status */}
              <div className="flex gap-3 items-start">
                <img
                  src={item.previewUrl}
                  alt="Receipt"
                  className="w-16 h-20 object-cover rounded border border-border flex-shrink-0 cursor-zoom-in hover:opacity-80 transition-opacity"
                  onClick={() => setLightboxItem({ src: item.previewUrl, id: item.id })}
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium truncate">
                    {item.file.name}
                    {item.compressedSize && (
                      <span className="text-muted-foreground font-normal ml-1">
                        ({(item.compressedSize / 1024).toFixed(0)} KB)
                      </span>
                    )}
                  </p>

                  {item.status === "uploading" && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                    </div>
                  )}
                  {item.status === "ocr" && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <ScanSearch className="h-3.5 w-3.5 animate-pulse text-primary" /> Extracting data…
                      </div>
                      <Progress value={Math.round(item.ocrProgress * 100)} className="h-1.5" />
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <XCircle className="h-3.5 w-3.5" /> {item.errorMessage}
                    </div>
                  )}
                  {item.status === "done" && (
                    <div className="flex items-center gap-2 text-sm text-accent-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
                    </div>
                  )}
                  {item.status === "ready" && item.ocrResult && (
                    <Badge className={confidenceColor(item.ocrResult.ai_confidence)}>
                      {Math.round(item.ocrResult.ai_confidence * 100)}% confidence
                    </Badge>
                  )}
                </div>
                {(item.status === "ready" || item.status === "error") && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeItem(item.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>

              {/* Editable fields – only when ready */}
              {item.status === "ready" && (
                <div className="space-y-2.5 pt-1 border-t border-border">
                  <div className="space-y-1">
                    <Label className="text-xs">Vendor</Label>
                    <Input
                      value={item.vendor}
                      onChange={(e) => updateItem(item.id, { vendor: e.target.value })}
                      placeholder="Store or vendor name"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Amount ($)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.amount}
                        onChange={(e) => updateItem(item.id, { amount: e.target.value })}
                        placeholder="0.00"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        value={item.date}
                        onChange={(e) => updateItem(item.id, { date: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select value={item.categoryId} onValueChange={(v) => updateItem(item.id, { categoryId: v })}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Notes (optional)</Label>
                    <Textarea
                      value={item.notes}
                      onChange={(e) => updateItem(item.id, { notes: e.target.value })}
                      placeholder="Any additional details…"
                      rows={1}
                      className="text-sm min-h-[32px]"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Submit all button */}
      {readyCount > 0 && (
        <Button className="w-full gap-2 h-12" onClick={handleSubmitAll} disabled={submittingAll || processingCount > 0}>
          {submittingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit {readyCount} Receipt{readyCount !== 1 ? "s" : ""}
        </Button>
      )}

      {/* Image lightbox */}
      <ReceiptImageViewer
        src={lightboxItem?.src ?? ""}
        open={!!lightboxItem}
        onOpenChange={(open) => { if (!open) setLightboxItem(null); }}
        onVendorSelect={(v) => { if (lightboxItem) updateItem(lightboxItem.id, { vendor: v }); }}
        onAmountSelect={(a) => { if (lightboxItem) updateItem(lightboxItem.id, { amount: a }); }}
      />
    </div>
  );
};

export default SubmitReceipt;
