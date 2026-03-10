import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Loader2, ScanSearch, Check, Trash2, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { runOcrRaw, parseTransactionRows, type ParsedTransactionRow } from "@/lib/ocr";

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
  const [csvRows, setCsvRows] = useState<ParsedTransactionRow[]>([]);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);

  // -- Screenshot handlers --
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
      const parsed = parseTransactionRows(rawText);
      setRows(parsed);
      if (parsed.length === 0) toast.info("No transaction rows detected in the image.");
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

  const confirmImport = useCallback(async (sourceRows: ParsedTransactionRow[], source: string, filename: string | null) => {
    if (!user || sourceRows.length === 0) return;

    const setImportingFn = source === "screenshot" ? setImporting : setCsvImporting;
    setImportingFn(true);

    try {
      // Create batch
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

      // Resolve card → user_id map
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

      // Insert transactions
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

      // Update batch
      await supabase
        .from("import_batches")
        .update({ status: "complete", imported_rows: sourceRows.length, failed_rows: 0 })
        .eq("id", batch.id);

      toast.success(`${sourceRows.length} transactions imported successfully!`);

      // Reset
      if (source === "screenshot") {
        setRows([]);
        setPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setCsvRows([]);
        setCsvFilename(null);
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
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) { toast.info("CSV appears empty."); return; }

      const header = lines[0].toLowerCase();
      const cols = header.split(",");
      const dateIdx = cols.findIndex((c) => c.includes("date"));
      const vendorIdx = cols.findIndex((c) => c.includes("vendor") || c.includes("description") || c.includes("merchant"));
      const amountIdx = cols.findIndex((c) => c.includes("amount") || c.includes("total"));
      const cardIdx = cols.findIndex((c) => c.includes("card"));

      const parsed: ParsedTransactionRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        parsed.push({
          date: dateIdx >= 0 ? vals[dateIdx] ?? "" : "",
          vendor: vendorIdx >= 0 ? vals[vendorIdx] ?? "" : "",
          amount: amountIdx >= 0 ? (vals[amountIdx] ?? "").replace(/[$,]/g, "") : "",
          card_last_four: cardIdx >= 0 ? vals[cardIdx] ?? "" : "",
        });
      }
      setCsvRows(parsed);
    };
    reader.readAsText(file);
  }, []);

  const updateCsvRow = (idx: number, field: keyof ParsedTransactionRow, value: string) => {
    setCsvRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const removeCsvRow = (idx: number) => {
    setCsvRows((prev) => prev.filter((_, i) => i !== idx));
  };

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

          {csvRows.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">{csvRows.length} row(s) parsed — review and edit before importing.</p>
              <EditableTable data={csvRows} onUpdate={updateCsvRow} onRemove={removeCsvRow} />
              <Button className="gap-2" onClick={() => confirmImport(csvRows, "csv", csvFilename)} disabled={csvImporting}>
                {csvImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Confirm Import ({csvRows.length})
              </Button>
            </>
          )}

          {csvRows.length === 0 && csvFilename && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <ImageIcon className="h-10 w-10" />
                <p className="text-sm">No rows parsed from CSV.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ImportTransactions;
