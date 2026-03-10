import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Upload, Loader2, CheckCircle, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { format } from "date-fns";

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
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      // Preview
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      setUploadResult(null);
      setReceiptId(null);

      // Upload
      setUploading(true);
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

        const result: UploadResult = {
          storagePath,
          publicUrl: urlData.publicUrl,
        };
        setUploadResult(result);

        // Create receipt row
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

        setReceiptId(receipt.id);
        toast.success("Receipt uploaded — starting OCR extraction…");

        // TODO: trigger OCR extraction here
      } catch (err: any) {
        toast.error(err.message ?? "Upload failed");
        setPreview(null);
      } finally {
        setUploading(false);
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
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileSelect}
        />

        <Button
          variant="outline"
          className="flex-1 h-12 gap-2"
          onClick={() => cameraRef.current?.click()}
          disabled={uploading}
        >
          <Camera className="h-5 w-5" />
          Camera
        </Button>

        <Button
          variant="outline"
          className="flex-1 h-12 gap-2"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-5 w-5" />
          Upload File
        </Button>
      </div>

      {/* Preview / loading / success */}
      {(preview || uploading) && (
        <Card className="overflow-hidden">
          <CardContent className="p-0 relative">
            {preview ? (
              <img
                src={preview}
                alt="Receipt preview"
                className="w-full max-h-[420px] object-contain bg-muted"
              />
            ) : (
              <div className="flex items-center justify-center h-48 bg-muted">
                <ImageIcon className="h-10 w-10 text-muted-foreground" />
              </div>
            )}

            {uploading && (
              <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm font-medium text-foreground">
                  Uploading…
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {uploadResult && !uploading && (
        <div className="flex items-center gap-2 text-sm text-accent">
          <CheckCircle className="h-4 w-4" />
          <span>Upload complete{receiptId ? " — receipt saved" : ""}</span>
        </div>
      )}
    </div>
  );
};

export default SubmitReceipt;
