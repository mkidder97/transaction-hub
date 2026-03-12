import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Loader2, ScanSearch, Check, Trash2, ImageIcon, History, Eye, X, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getSignedReceiptUrl } from "@/lib/getSignedReceiptUrl";
import { toast } from "sonner";
import { type ParsedTransactionRow } from "@/lib/ocr";
import { v4 as uuidv4 } from "uuid";

interface ImportBatch {
  id: string;
  created_at: string;
  source: string;
  filename: string | null;
  total_rows: number | null;
  imported_rows: number | null;
  status: string;
  file_paths: string[] | null;
  importer: { full_name: string | null } | null;
}

const REQUIRED_FIELDS = ["date", "vendor", "amount", "card_last_four"] as const;
type MappableField = (typeof REQUIRED_FIELDS)[number];

const FIELD_LABELS: Record<MappableField, string> = {
  date: "Date",
  vendor: "Vendor",
  amount: "Amount",
  card_last_four: "Card Last 4",
};

const ImportTransactions = () => {
  const { user } = useAuth();

  // Screenshot tab state
  const [previews, setPreviews] = useState<string[]>([]);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrTotal, setOcrTotal] = useState(0);
  const [ocrCurrent, setOcrCurrent] = useState(0);
  const [rows, setRows] = useState<ParsedTransactionRow[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [screenshotPaths, setScreenshotPaths] = useState<string[]>([]);

  // CSV tab state
  const [csvRawRows, setCsvRawRows] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<MappableField, string>>({
    date: "",
    vendor: "",
    amount: "",
    card_last_four: "",
  });
  const [csvMapped, setCsvMapped] = useState<ParsedTransactionRow[]>([]);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  // Import history state
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchFileUrls, setBatchFileUrls] = useState<Record<string, string[]>>({});

  const fetchBatches = useCallback(async () => {
    setBatchesLoading(true);
    const { data } = await supabase
      .from("import_batches")
      .select("id, created_at, source, filename, total_rows, imported_rows, status, file_paths, importer:profiles!import_batches_imported_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setBatches(data as unknown as ImportBatch[]);
    setBatchesLoading(false);
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const handleScreenshot = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    const fileList = Array.from(files);
    const localUrls = fileList.map((f) => URL.createObjectURL(f));
    setPreviews(localUrls);
    setRows([]);
    setScreenshotPaths([]);
    setOcrRunning(true);
    setOcrProgress(0);
    setOcrTotal(fileList.length);
    setOcrCurrent(0);

    const allRows: ParsedTransactionRow[] = [];
    const allPaths: string[] = [];
    let failCount = 0;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setOcrCurrent(i + 1);
      setOcrProgress((i) / fileList.length);

      try {
        const storagePath = `screenshots/${uuidv4()}.jpg`;
        const { error: uploadErr } = await supabase.storage
          .from("transaction-screenshots")
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (uploadErr) throw uploadErr;
        allPaths.push(storagePath);

        const { data: urlData } = supabase.storage.from("transaction-screenshots").getPublicUrl(storagePath);

        const { data: extractData, error: extractErr } = await supabase.functions.invoke(
          "extract-transactions",
          { body: { imageUrl: urlData.publicUrl } },
        );

        if (extractErr) throw new Error(extractErr.message || "AI extraction failed");

        const txRows: ParsedTransactionRow[] = (extractData?.transactions || []).map((t: any) => ({
          date: t.date || "",
          vendor: t.vendor || "Unknown",
          amount: t.amount || "0",
          card_last_four: t.card_last_four || "",
        }));
        allRows.push(...txRows);
      } catch (err: any) {
        failCount++;
        toast.error(`Screenshot ${i + 1} failed: ${err.message || "Extraction error"}`);
      }
    }

    setOcrProgress(1);
    setRows(allRows);
    setScreenshotPaths(allPaths);
    if (allRows.length === 0 && failCount === 0) {
      toast.error("No transactions detected — try clearer screenshots.");
    } else if (allRows.length > 0) {
      toast.success(`Extracted ${allRows.length} transaction(s) from ${fileList.length - failCount} screenshot(s).`);
    }
    setOcrRunning(false);
  }, [user]);

  const updateRow = (idx: number, field: keyof ParsedTransactionRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  // -- Shared import logic --
  const confirmImport = useCallback(async (sourceRows: ParsedTransactionRow[], source: string, filename: string | null, filePaths?: string[]) => {
    if (!user || sourceRows.length === 0) return;
    const setImportingFn = source === "screenshot" ? setImporting : setCsvImporting;
    setImportingFn(true);

    try {
      const { data: batch, error: batchErr } = await supabase
        .from("import_batches")
        .insert({
          source,
          filename: filename ?? undefined,
          total_rows: sourceRows.length,
          status: "processing",
          imported_by: user.id,
          file_paths: filePaths ?? [],
        })
        .select("id")
        .single();
      if (batchErr || !batch) throw batchErr ?? new Error("Failed to create batch");

      const cards = [...new Set(sourceRows.map((r) => r.card_last_four).filter(Boolean))];
      const cardUserMap: Record<string, string> = {};
      if (cards.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, card_last_four")
          .in("card_last_four", cards);
        if (profiles) {
          for (const p of profiles) {
            if (p.card_last_four) cardUserMap[p.card_last_four] = p.id;
          }
        }
      }

      const txRows = sourceRows.map((r) => ({
        import_batch_id: batch.id,
        source,
        transaction_date: r.date || null,
        vendor_raw: r.vendor || null,
        amount: r.amount ? parseFloat(r.amount) : null,
        card_last_four: r.card_last_four ? r.card_last_four.replace(/\D/g, "").slice(-4) || null : null,
        user_id: r.card_last_four ? cardUserMap[r.card_last_four.replace(/\D/g, "").slice(-4)] ?? null : null,
      }));

      // -- Deduplication: check existing transactions for same date+amount+card --
      const dates = txRows.map(r => r.transaction_date).filter(Boolean) as string[];
      const minDate = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null;
      const maxDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;
      const cardValues = [...new Set(txRows.map(r => r.card_last_four).filter(Boolean))] as string[];

      let existingKeys = new Set<string>();
      if (minDate && maxDate && cardValues.length > 0) {
        const { data: existing } = await supabase
          .from("transactions")
          .select("transaction_date, amount, card_last_four")
          .in("card_last_four", cardValues)
          .gte("transaction_date", minDate)
          .lte("transaction_date", maxDate);
        existingKeys = new Set(
          (existing ?? []).map(r => `${r.transaction_date}|${r.amount}|${r.card_last_four}`)
        );
      }

      const toInsert = txRows.filter(
        r => !existingKeys.has(`${r.transaction_date}|${r.amount}|${r.card_last_four}`)
      );
      const skippedCount = txRows.length - toInsert.length;

      let insertedTxs: { id: string; user_id: string | null }[] | null = null;

      if (toInsert.length > 0) {
        const { data, error: txErr } = await supabase.from("transactions").insert(toInsert).select("id, user_id");
        if (txErr) throw txErr;
        insertedTxs = data;
      }

      await supabase
        .from("import_batches")
        .update({ status: "complete", imported_rows: toInsert.length, failed_rows: 0 })
        .eq("id", batch.id);

      // Auto-match: find unmatched receipts for each user and try to match
      if (insertedTxs && insertedTxs.length > 0) {
        const userIds = [...new Set(insertedTxs.map(t => t.user_id).filter(Boolean))];
        if (userIds.length > 0) {
          const { data: unmatchedReceipts } = await supabase
            .from("receipts")
            .select("id")
            .in("user_id", userIds)
            .eq("match_status", "unmatched");
          if (unmatchedReceipts) {
            const { matchReceiptToTransactions } = await import("@/lib/matcher");
            let autoMatched = 0;
            for (const rec of unmatchedReceipts) {
              const result = await matchReceiptToTransactions(rec.id);
              if (result.status === "matched" && result.transactionId) {
                await supabase.from("receipts").update({
                  match_status: "matched",
                  transaction_id: result.transactionId,
                  match_confidence: result.score,
                }).eq("id", rec.id);
                await supabase.from("transactions").update({
                  match_status: "matched",
                  match_confidence: result.score,
                  receipt_id: rec.id,
                }).eq("id", result.transactionId);
                autoMatched++;
              } else if (result.status === "needs_review" && result.transactionId) {
                await supabase.from("receipts").update({
                  match_status: "manual_match",
                  transaction_id: result.transactionId,
                  match_confidence: result.score,
                }).eq("id", rec.id);
              }
            }
            if (autoMatched > 0) {
              toast.success(`Auto-matched ${autoMatched} receipt(s) to transactions!`);
            }
          }
        }
      }

      if (toInsert.length > 0) {
        toast.success(`${toInsert.length} transaction(s) imported successfully!`);
      }
      if (skippedCount > 0) {
        toast.warning(`${skippedCount} duplicate transaction(s) skipped — they already exist in this period.`);
      }
      fetchBatches();

      if (source === "screenshot") {
        setRows([]);
        setPreviews([]);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setCsvRawRows([]);
        setCsvHeaders([]);
        setCsvMapped([]);
        setCsvFilename(null);
        setCsvMapping({ date: "", vendor: "", amount: "", card_last_four: "" });
        if (csvRef.current) csvRef.current.value = "";
      }
    } catch (err: any) {
      toast.error(err.message ?? "Import failed");
    } finally {
      setImportingFn(false);
    }
  }, [user]);

  // -- CSV handlers --
  const handleCsv = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFilename(file.name);
    setCsvMapped([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { toast.info("CSV appears empty."); return; }

      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      setCsvHeaders(headers);

      const dataRows = lines.slice(1).map((l) => l.split(",").map((v) => v.trim().replace(/^"|"$/g, "")));
      setCsvRawRows(dataRows);

      // Auto-guess mapping
      const lowerHeaders = headers.map((h) => h.toLowerCase());
      const guessed: Record<MappableField, string> = { date: "", vendor: "", amount: "", card_last_four: "" };
      const dateIdx = lowerHeaders.findIndex((h) => h.includes("date"));
      if (dateIdx >= 0) guessed.date = headers[dateIdx];
      const vendorIdx = lowerHeaders.findIndex((h) => h.includes("vendor") || h.includes("description") || h.includes("merchant"));
      if (vendorIdx >= 0) guessed.vendor = headers[vendorIdx];
      const amountIdx = lowerHeaders.findIndex((h) => h.includes("amount") || h.includes("total"));
      if (amountIdx >= 0) guessed.amount = headers[amountIdx];
      const cardIdx = lowerHeaders.findIndex((h) => h.includes("card"));
      if (cardIdx >= 0) guessed.card_last_four = headers[cardIdx];
      setCsvMapping(guessed);
    };
    reader.readAsText(file);
  }, []);

  const applyMapping = useCallback(() => {
    const mapped: ParsedTransactionRow[] = csvRawRows.map((vals) => {
      const get = (field: MappableField) => {
        const col = csvMapping[field];
        if (!col) return "";
        const idx = csvHeaders.indexOf(col);
        return idx >= 0 ? (vals[idx] ?? "") : "";
      };
      return {
        date: get("date"),
        vendor: get("vendor"),
        amount: get("amount").replace(/[$,]/g, ""),
        card_last_four: get("card_last_four"),
      };
    });
    setCsvMapped(mapped);
  }, [csvRawRows, csvHeaders, csvMapping]);

  // -- Shared editable table --
  const EditableTable = ({
    data,
    onUpdate,
    onRemove,
  }: {
    data: ParsedTransactionRow[];
    onUpdate: (idx: number, field: keyof ParsedTransactionRow, val: string) => void;
    onRemove: (idx: number) => void;
  }) => (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Card Last 4</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="w-[130px] min-w-[130px]">
                <Input type="date" value={r.date} onChange={(e) => onUpdate(i, "date", e.target.value)} className="h-8 w-full" />
              </TableCell>
              <TableCell>
                <Input value={r.vendor} onChange={(e) => onUpdate(i, "vendor", e.target.value)} className="h-8 w-full" />
              </TableCell>
              <TableCell className="w-[90px] min-w-[90px]">
                <Input type="number" step="0.01" value={r.amount} onChange={(e) => onUpdate(i, "amount", e.target.value)} className="h-8 w-full" />
              </TableCell>
              <TableCell className="w-[80px] min-w-[80px]">
                <Input value={r.card_last_four} onChange={(e) => onUpdate(i, "card_last_four", e.target.value)} maxLength={4} className="h-8 w-full" />
              </TableCell>
              <TableCell className="w-10">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemove(i)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Import Transactions</h1>
        <p className="text-muted-foreground text-sm">
          Import credit card statement data via screenshot OCR or CSV upload.
        </p>
      </div>

      <Tabs defaultValue="screenshot">
        <TabsList>
          <TabsTrigger value="screenshot">Screenshot</TabsTrigger>
          <TabsTrigger value="csv">CSV</TabsTrigger>
        </TabsList>

        {/* Screenshot Tab */}
        <TabsContent value="screenshot" className="space-y-4 mt-4">
          <div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleScreenshot} />
            <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={ocrRunning || importing}>
              <Upload className="h-4 w-4" /> Upload Screenshots
            </Button>
          </div>

          {previews.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {previews.map((src, i) => (
                  <Card key={i} className="overflow-hidden shrink-0 w-48">
                    <CardContent className="p-0">
                      <img src={src} alt={`Screenshot ${i + 1}`} className="w-full h-28 object-cover bg-muted" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              {ocrRunning && (
                <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50">
                  <ScanSearch className="h-5 w-5 animate-pulse text-primary shrink-0" />
                  <div className="flex-1 space-y-1">
                    <span className="text-sm font-medium">Extracting… ({ocrCurrent} of {ocrTotal})</span>
                    <Progress value={Math.round(ocrProgress * 100)} className="h-2" />
                  </div>
                </div>
              )}
            </div>
          )}

          {rows.length > 0 && !ocrRunning && (
            <>
              <p className="text-sm text-muted-foreground">{rows.length} row(s) detected — review and edit before importing.</p>
              <EditableTable data={rows} onUpdate={updateRow} onRemove={removeRow} />
              <Button className="gap-2" onClick={() => confirmImport(rows, "screenshot", null)} disabled={importing}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Confirm Import ({rows.length})
              </Button>
            </>
          )}
        </TabsContent>

        {/* CSV Tab */}
        <TabsContent value="csv" className="space-y-4 mt-4">
          <div>
            <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsv} />
            <Button variant="outline" className="gap-2" onClick={() => csvRef.current?.click()} disabled={csvImporting}>
              <Upload className="h-4 w-4" /> Upload CSV
            </Button>
            {csvFilename && <span className="ml-3 text-sm text-muted-foreground">{csvFilename}</span>}
          </div>

          {/* Column mapping UI */}
          {csvHeaders.length > 0 && csvMapped.length === 0 && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <h3 className="text-sm font-semibold">Map CSV Columns</h3>
                <p className="text-xs text-muted-foreground">
                  Select which CSV column corresponds to each field.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {REQUIRED_FIELDS.map((field) => (
                    <div key={field} className="space-y-1.5">
                      <Label className="text-xs">{FIELD_LABELS[field]}</Label>
                      <Select
                        value={csvMapping[field]}
                        onValueChange={(val) =>
                          setCsvMapping((prev) => ({ ...prev, [field]: val }))
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="— select column —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— none —</SelectItem>
                          {csvHeaders.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                {/* Raw preview */}
                {csvRawRows.length > 0 && (
                  <div className="rounded-lg border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {csvHeaders.map((h) => (
                            <TableHead key={h} className="text-xs whitespace-nowrap">
                              {h}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvRawRows.slice(0, 3).map((row, i) => (
                          <TableRow key={i}>
                            {row.map((cell, j) => (
                              <TableCell key={j} className="text-xs py-1">
                                {cell}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-[11px] text-muted-foreground px-3 py-1.5">
                      Showing first {Math.min(3, csvRawRows.length)} of {csvRawRows.length} rows
                    </p>
                  </div>
                )}

                <Button className="gap-2" onClick={applyMapping}>
                  <Check className="h-4 w-4" /> Apply Mapping
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Mapped preview + confirm */}
          {csvMapped.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                {csvMapped.length} row(s) mapped — preview first 5 rows, then confirm.
              </p>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Card Last 4</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvMapped.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{r.date || "—"}</TableCell>
                        <TableCell className="text-sm">{r.vendor || "—"}</TableCell>
                        <TableCell className="text-sm">{r.amount ? `$${parseFloat(r.amount).toFixed(2)}` : "—"}</TableCell>
                        <TableCell className="text-sm">{r.card_last_four || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {csvMapped.length > 5 && (
                  <p className="text-[11px] text-muted-foreground px-3 py-1.5">
                    …and {csvMapped.length - 5} more rows
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setCsvMapped([])}
                >
                  Back to Mapping
                </Button>
                <Button className="gap-2" onClick={() => confirmImport(csvMapped, "csv", csvFilename)} disabled={csvImporting}>
                  {csvImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Confirm Import ({csvMapped.length})
                </Button>
              </div>
            </>
          )}

          {csvHeaders.length === 0 && csvFilename && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <ImageIcon className="h-10 w-10" />
                <p className="text-sm">No data found in CSV.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Import History */}
      <Separator />
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5" /> Import History
        </h2>
        {batchesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No imports yet.</p>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Imported By</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {new Date(b.created_at).toLocaleDateString()}{" "}
                      <span className="text-muted-foreground text-xs">
                        {new Date(b.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {b.source === "screenshot" ? "Screenshot" : "CSV"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[160px]">
                      {b.filename ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {b.importer?.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {b.imported_rows ?? 0} / {b.total_rows ?? 0}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 ${
                          b.status === "complete"
                            ? "bg-accent/15 text-accent"
                            : b.status === "processing"
                            ? "bg-warning/15 text-warning"
                            : b.status === "failed"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportTransactions;
