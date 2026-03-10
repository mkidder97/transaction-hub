import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Camera, Upload, Loader2, CheckCircle, ImageIcon, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { format } from "date-fns";
import { runOcr, type OcrResult } from "@/lib/ocr";

interface UploadResult {
  storagePath: string;
  publicUrl: string;
}

const SubmitReceipt = () => {
  const { user } = useAuth();
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  // OCR state
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      setUploadResult(null);
      setReceiptId(null);
      setOcrResult(null);
      setOcrProgress(0);

      // Upload
      setUploading(true);
      let createdReceiptId: string | null = null;
      try {
        const ext = file.name.split(".").pop() ?? "jpg";
        const monthFolder = format(new Date(), "yyyy-MM");
        const storagePath = `receipts/${user.id}/${monthFolder}/${uuidv4()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(storagePath, file, { contentType: file.type, upsert: false });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("receipts")
          .getPublicUrl(storagePath);

        setUploadResult({ storagePath, publicUrl: urlData.publicUrl });

        const { data: receipt, error: insertError } = await supabase
          .from("receipts")
          .insert({
            user_id: user.id,
            storage_path: storagePath,
            photo_url: urlData.publicUrl,
            status: "pending",
          })
          .select("id")
          .single();

        if (insertError) throw insertError;
        createdReceiptId = receipt.id;
        setReceiptId(receipt.id);
        toast.success("Upload complete — extracting data…");
      } catch (err: any) {
        toast.error(err.message ?? "Upload failed");
        setPreview(null);
        setUploading(false);
        return;
      }
      setUploading(false);

      // OCR
      setOcrRunning(true);
      try {
        const result = await runOcr(objectUrl, setOcrProgress);
        setOcrResult(result);

        // Update receipt row with OCR data
        if (createdReceiptId) {
          await supabase
            .from("receipts")
            .update({
              vendor_extracted: result.vendor_extracted,
              amount_extracted: result.amount_extracted,
              date_extracted: result.date_extracted,
              ai_confidence: result.ai_confidence,
              ai_raw_text: result.ai_raw_text,
            })
            .eq("id", createdReceiptId);
        }

        toast.success("Data extracted successfully");
      } catch {
        toast.error("OCR extraction failed");
      } finally {
        setOcrRunning(false);
      }
    },
    [user],
  );

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Submit Receipt</h1>
        <p className="text-muted-foreground text-sm">
          Snap a photo or upload an image of your receipt.
        </p>
      </div>

      {/* Upload buttons */}
      <div className="flex gap-3">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileSelect} />

        <Button variant="outline" className="flex-1 h-12 gap-2" onClick={() => cameraRef.current?.click()} disabled={uploading || ocrRunning}>
          <Camera className="h-5 w-5" /> Camera
        </Button>
        <Button variant="outline" className="flex-1 h-12 gap-2" onClick={() => fileRef.current?.click()} disabled={uploading || ocrRunning}>
          <Upload className="h-5 w-5" /> Upload File
        </Button>
      </div>

      {/* Preview */}
      {(preview || uploading) && (
        <Card className="overflow-hidden">
          <CardContent className="p-0 relative">
            {preview ? (
              <img src={preview} alt="Receipt preview" className="w-full max-h-[420px] object-contain bg-muted" />
            ) : (
              <div className="flex items-center justify-center h-48 bg-muted">
                <ImageIcon className="h-10 w-10 text-muted-foreground" />
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm font-medium">Uploading…</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* OCR progress */}
      {ocrRunning && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ScanSearch className="h-4 w-4 animate-pulse text-primary" />
            Extracting receipt data…
          </div>
          <Progress value={Math.round(ocrProgress * 100)} className="h-2" />
        </div>
      )}

      {/* Upload success */}
      {uploadResult && !uploading && !ocrRunning && !ocrResult && (
        <div className="flex items-center gap-2 text-sm text-accent">
          <CheckCircle className="h-4 w-4" />
          <span>Upload complete</span>
        </div>
      )}

      {/* OCR results */}
      {ocrResult && !ocrRunning && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-accent" /> Extracted Data
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Vendor</dt>
              <dd className="font-medium">{ocrResult.vendor_extracted ?? "—"}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium">{ocrResult.amount_extracted != null ? `$${ocrResult.amount_extracted.toFixed(2)}` : "—"}</dd>
              <dt className="text-muted-foreground">Date</dt>
              <dd className="font-medium">{ocrResult.date_extracted ?? "—"}</dd>
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="font-medium">{Math.round(ocrResult.ai_confidence * 100)}%</dd>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SubmitReceipt;
