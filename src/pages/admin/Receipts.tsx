import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Download, Files, FileText, Loader2, Archive } from "lucide-react";
import { toast } from "sonner";
import { generateReceiptReviewPdf } from "@/lib/generateReceiptReviewPdf";
import { getSignedReceiptUrl } from "@/lib/getSignedReceiptUrl";
import JSZip from "jszip";

interface Period {
  id: string;
  name: string;
  is_current: boolean;
}

interface ReceiptRow {
  id: string;
  vendor_extracted: string | null;
  vendor_confirmed: string | null;
  amount_extracted: number | null;
  amount_confirmed: number | null;
  date_extracted: string | null;
  date_confirmed: string | null;
  status: string;
  match_status: string;
  match_confidence: number | null;
  flag_reason: string | null;
  photo_url: string | null;
  storage_path: string | null;
  created_at: string;
  employee: { full_name: string | null; card_last_four: string | null } | null;
  category: { name: string } | null;
  period: { name: string } | null;
  transaction: {
    vendor_normalized: string | null;
    amount: number | null;
    transaction_date: string | null;
  } | null;
}

const STATUS_OPTIONS = ["all", "pending", "approved", "flagged"] as const;
const MATCH_OPTIONS = ["all", "unmatched", "matched", "auto_matched", "manual_match"] as const;

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  approved: "bg-accent/15 text-accent",
  flagged: "bg-destructive/15 text-destructive",
};

const AdminReceipts = () => {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    supabase
      .from("statement_periods")
      .select("id, name, is_current")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setPeriods(data);
          const current = data.find((p) => p.is_current);
          if (current) setPeriodId(current.id);
        }
      });
  }, []);

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    let q = supabase
      .from("receipts")
      .select(
        "id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, flag_reason, photo_url, storage_path, created_at, employee:profiles!receipts_user_id_fkey(full_name, card_last_four), category:expense_categories(name), period:statement_periods(name), transaction:transactions!receipts_transaction_id_fkey(vendor_normalized, amount, transaction_date)"
      )
      .order("created_at", { ascending: false });

    if (periodId !== "all") q = q.eq("statement_period_id", periodId);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    if (matchFilter !== "all") q = q.eq("match_status", matchFilter);

    const { data } = await q;
    setReceipts((data as unknown as ReceiptRow[]) ?? []);
    setLoading(false);
  }, [periodId, statusFilter, matchFilter]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  /* ── CSV Export ─────────────────────────────────── */
  const handleCsvExport = () => {
    if (receipts.length === 0) {
      toast.error("No receipts to export");
      return;
    }

    const headers = [
      "Employee",
      "Card Last Four",
      "Period",
      "Submitted Date",
      "Receipt Date (AI)",
      "Vendor (AI)",
      "Amount",
      "Category",
      "Match Status",
      "Match Confidence",
      "Tx Date (Amex)",
      "Tx Vendor (Amex)",
      "Tx Amount",
      "Flagged Reason",
      "Photo URL",
    ];

    const escape = (v: string) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };

    const rows = receipts.map((r) => {
      const vendor = r.vendor_confirmed ?? r.vendor_extracted ?? "";
      const amount = r.amount_confirmed ?? r.amount_extracted;
      const date = r.date_confirmed ?? r.date_extracted ?? "";
      return [
        (r.employee as any)?.full_name ?? "",
        (r.employee as any)?.card_last_four ?? "",
        (r.period as any)?.name ?? "",
        r.created_at ? new Date(r.created_at).toLocaleDateString() : "",
        date,
        vendor,
        amount != null ? amount.toFixed(2) : "",
        (r.category as any)?.name ?? "",
        r.match_status,
        r.match_confidence != null ? `${Math.round(r.match_confidence * 100)}%` : "",
        (r.transaction as any)?.transaction_date ?? "",
        (r.transaction as any)?.vendor_normalized ?? "",
        (r.transaction as any)?.amount != null ? Number((r.transaction as any).amount).toFixed(2) : "",
        r.flag_reason ?? "",
        r.photo_url ?? "",
      ].map((v) => escape(String(v)));
    });

    const csv = [headers.map((h) => escape(h)).join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const periodName = periods.find((p) => p.id === periodId)?.name ?? "all";
    a.href = url;
    a.download = `receipts-${periodName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const fmt = (n: number | null) => (n != null ? `$${Number(n).toFixed(2)}` : "—");

  const handleDownloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      const selectedReceipts = receipts.filter((r) => selected.has(r.id));
      let added = 0;

      for (const receipt of selectedReceipts) {
        if (!receipt.storage_path) continue;
        const signedUrl = await getSignedReceiptUrl(receipt.storage_path);
        if (!signedUrl) continue;

        const resp = await fetch(signedUrl);
        const blob = await resp.blob();

        const vendor = (receipt.vendor_confirmed ?? receipt.vendor_extracted ?? "unknown")
          .replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
        const date = receipt.date_confirmed ?? receipt.date_extracted ?? "unknown";
        const emp = ((receipt.employee as any)?.full_name ?? "employee")
          .replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
        const ext = blob.type.includes("png") ? "png" : blob.type.includes("pdf") ? "pdf" : "jpg";

        zip.file(`${emp}_${vendor}_${date}.${ext}`, blob);
        added++;
      }

      if (added === 0) {
        toast.error("No downloadable receipt images found");
        return;
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      const periodName = periods.find((p) => p.id === periodId)?.name ?? "receipts";
      a.href = url;
      a.download = `receipts-${periodName.replace(/\s+/g, "-").toLowerCase()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${added} receipt(s)`);
      setSelected(new Set());
    } catch {
      toast.error("Failed to create ZIP");
    } finally {
      setZipping(false);
    }
  };

  const allSelected = receipts.length > 0 && receipts.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(receipts.map((r) => r.id)));
    }
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">All Receipts</h1>
        <p className="text-muted-foreground text-sm">
          View and export all employee receipts.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Periods</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={matchFilter} onValueChange={setMatchFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Match" />
          </SelectTrigger>
          <SelectContent>
            {MATCH_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All match statuses" : s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            className="gap-2"
            disabled={receipts.length === 0 || generating}
            onClick={async () => {
              setGenerating(true);
              try {
                await generateReceiptReviewPdf(periodId);
              } catch (e: any) {
                toast.error(e?.message || "Failed to generate PDF");
              } finally {
                setGenerating(false);
              }
            }}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Receipt Review PDF
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleCsvExport}>
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : receipts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Files className="h-10 w-10" />
            <p className="text-sm">No receipts found for the selected filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Tx Vendor</TableHead>
                <TableHead className="text-right">Tx Amt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((r) => {
                const vendor = r.vendor_confirmed ?? r.vendor_extracted ?? "—";
                const amount = r.amount_confirmed ?? r.amount_extracted;
                const date = r.date_confirmed ?? r.date_extracted;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{(r.employee as any)?.full_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{vendor}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{fmt(amount ?? null)}</TableCell>
                    <TableCell className="text-sm">{date ?? "—"}</TableCell>
                    <TableCell className="text-sm">{(r.category as any)?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColor[r.status] ?? ""}`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {r.match_status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{(r.transaction as any)?.vendor_normalized ?? "—"}</TableCell>
                    <TableCell className="text-sm text-right">{fmt((r.transaction as any)?.amount ?? null)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default AdminReceipts;
