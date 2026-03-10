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
import { Upload, Loader2, ScanSearch, Check, Trash2, ImageIcon, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { runOcrRaw, parseTransactionList, parseTransactionRows, type ParsedTransactionRow } from "@/lib/ocr";

interface ImportBatch {
  id: string;
  created_at: string;
  source: string;
  filename: string | null;
  total_rows: number | null;
  imported_rows: number | null;
  status: string;
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
  const [preview, setPreview] = useState<string | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [rows, setRows] = useState<ParsedTransactionRow[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const fetchBatches = useCallback(async () => {
    setBatchesLoading(true);
    const { data } = await supabase
      .from("import_batches")
      .select("id, created_at, source, filename, total_rows, imported_rows, status, importer:profiles!import_batches_imported_by_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setBatches(data as unknown as ImportBatch[]);
    setBatchesLoading(false);
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const handleScreenshot = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setRows([]);
    setOcrRunning(true);
    setOcrProgress(0);
    try {
      const rawText = await runOcrRaw(url, setOcrProgress);
      const parsed = parseTransactionList(rawText);
      const asRows: ParsedTransactionRow[] = parsed.map((t) => ({
        date: t.date,
        vendor: t.vendor,
        amount: String(t.amount),
        card_last_four: "",
      }));
      setRows(asRows);
      if (asRows.length === 0) toast.error("No transactions detected — try a clearer screenshot of your transaction list.");
    } catch {
      toast.error("OCR extraction failed");
    } finally {
      setOcrRunning(false);
    }
  }, []);

  const updateRow = (idx: number, field: keyof ParsedTransactionRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  // -- Shared import logic --
  const confirmImport = useCallback(async (sourceRows: ParsedTransactionRow[], source: string, filename: string | null) => {
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
        card_last_four: r.card_last_four || null,
        user_id: r.card_last_four ? cardUserMap[r.card_last_four] ?? null : null,
      }));

      const { error: txErr } = await supabase.from("transactions").insert(txRows);
      if (txErr) throw txErr;

      await supabase
        .from("import_batches")
        .update({ status: "complete", imported_rows: sourceRows.length, failed_rows: 0 })
        .eq("id", batch.id);

      toast.success(`${sourceRows.length} transactions imported successfully!`);
      fetchBatches();

      if (source === "screenshot") {
        setRows([]);
        setPreview(null);
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
              <TableCell>
                <Input type="date" value={r.date} onChange={(e) => onUpdate(i, "date", e.target.value)} className="h-8 w-36" />
              </TableCell>
              <TableCell>
                <Input value={r.vendor} onChange={(e) => onUpdate(i, "vendor", e.target.value)} className="h-8" />
              </TableCell>
              <TableCell>
                <Input type="number" step="0.01" value={r.amount} onChange={(e) => onUpdate(i, "amount", e.target.value)} className="h-8 w-28" />
              </TableCell>
              <TableCell>
                <Input value={r.card_last_four} onChange={(e) => onUpdate(i, "card_last_four", e.target.value)} maxLength={4} className="h-8 w-20" />
              </TableCell>
              <TableCell>
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
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleScreenshot} />
            <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={ocrRunning || importing}>
              <Upload className="h-4 w-4" /> Upload Screenshot
            </Button>
          </div>

          {preview && (
            <Card className="overflow-hidden">
              <CardContent className="p-0 relative">
                <img src={preview} alt="Statement screenshot" className="w-full max-h-[300px] object-contain bg-muted" />
                {ocrRunning && (
                  <div className="absolute inset-0 bg-background/70 flex flex-col items-center justify-center gap-2">
                    <ScanSearch className="h-8 w-8 animate-pulse text-primary" />
                    <span className="text-sm font-medium">Extracting transactions…</span>
                    <Progress value={Math.round(ocrProgress * 100)} className="h-2 w-48" />
                  </div>
                )}
              </CardContent>
            </Card>
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
