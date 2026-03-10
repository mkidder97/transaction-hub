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
  ImageIcon,
  ScanSearch,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { format } from "date-fns";
import { runOcr, type OcrResult } from "@/lib/ocr";

interface UploadData {
  storagePath: string;
  publicUrl: string;
}

interface Category {
  id: string;
  name: string;
}

const SubmitReceipt = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadData, setUploadData] = useState<UploadData | null>(null);

  // OCR
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);

  // Form fields
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Categories
  const [categories, setCategories] = useState<Category[]>([]);

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

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      setUploadData(null);
      setOcrResult(null);
      setOcrProgress(0);
      setVendor("");
      setAmount("");
      setDate("");
      setCategoryId("");
      setNotes("");

      // Upload to storage
      setUploading(true);
      let storagePath: string;
      let publicUrl: string;
      try {
        const ext = file.name.split(".").pop() ?? "jpg";
        const monthFolder = format(new Date(), "yyyy-MM");
        storagePath = `receipts/${user.id}/${monthFolder}/${uuidv4()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("receipts")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("receipts")
          .getPublicUrl(storagePath);
        publicUrl = urlData.publicUrl;

        setUploadData({ storagePath, publicUrl });
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
        // Pre-fill form
        setVendor(result.vendor_extracted ?? "");
        setAmount(result.amount_extracted != null ? String(result.amount_extracted) : "");
        setDate(result.date_extracted ?? "");
      } catch {
        toast.error("OCR extraction failed");
      } finally {
        setOcrRunning(false);
      }
    },
    [user],
  );

  const handleSubmit = async () => {
    if (!user || !uploadData || !ocrResult) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from("receipts").insert({
        user_id: user.id,
        photo_url: uploadData.publicUrl,
        storage_path: uploadData.storagePath,
        vendor_extracted: ocrResult.vendor_extracted,
        amount_extracted: ocrResult.amount_extracted,
        date_extracted: ocrResult.date_extracted,
        ai_raw_text: ocrResult.ai_raw_text,
        ai_confidence: ocrResult.ai_confidence,
        vendor_confirmed: vendor || null,
        amount_confirmed: amount ? parseFloat(amount) : null,
        date_confirmed: date || null,
        category_id: categoryId || null,
        notes: notes || null,
        status: "pending",
      });
      if (error) throw error;
      toast.success("Receipt submitted successfully!");
      navigate("/employee/receipts");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit receipt");
    } finally {
      setSubmitting(false);
    }
  };

  const confidenceBadge = (score: number) => {
    if (score > 0.8)
      return <Badge className="bg-accent text-accent-foreground">{Math.round(score * 100)}% confidence</Badge>;
    if (score >= 0.5)
      return <Badge className="bg-warning text-warning-foreground">{Math.round(score * 100)}% confidence</Badge>;
    return <Badge className="bg-destructive text-destructive-foreground">{Math.round(score * 100)}% confidence</Badge>;
  };

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
        <Button variant="outline" className="flex-1 h-12 gap-2" onClick={() => cameraRef.current?.click()} disabled={uploading || ocrRunning || submitting}>
          <Camera className="h-5 w-5" /> Camera
        </Button>
        <Button variant="outline" className="flex-1 h-12 gap-2" onClick={() => fileRef.current?.click()} disabled={uploading || ocrRunning || submitting}>
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
          <div className="flex items-center gap-2 text-sm font-medium">
            <ScanSearch className="h-4 w-4 animate-pulse text-primary" />
            Extracting receipt data…
          </div>
          <Progress value={Math.round(ocrProgress * 100)} className="h-2" />
        </div>
      )}

      {/* Review form */}
      {ocrResult && !ocrRunning && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Review Extracted Data</h2>
              {confidenceBadge(ocrResult.ai_confidence)}
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="vendor">Vendor</Label>
                <Input id="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Store or vendor name" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="amount">Amount ($)</Label>
                  <Input id="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date">Date</Label>
                  <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category">Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="category">
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

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional details…" rows={2} />
              </div>
            </div>

            <Button className="w-full gap-2" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Receipt
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SubmitReceipt;
