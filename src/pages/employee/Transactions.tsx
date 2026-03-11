import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Receipt, FileText, Paperclip, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { format } from "date-fns";
import { TransactionDetailPanel } from "@/components/employee/TransactionDetailPanel";

interface Period { id: string; name: string; is_current: boolean }

interface TransactionRow {
  id: string;
  transaction_date: string | null;
  vendor_raw: string | null;
  vendor_normalized: string | null;
  amount: number | null;
  card_last_four: string | null;
  match_status: string;
  statement_period_id: string | null;
}

const MATCH_OPTIONS = ["all", "unmatched", "matched"] as const;

const matchColor: Record<string, string> = {
  unmatched: "bg-warning/15 text-warning",
  matched: "bg-accent/15 text-accent",
  manual_match: "bg-primary/15 text-primary",
};

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

const EmployeeTransactions = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [linkedTxIds, setLinkedTxIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodFilter, setPeriodFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [attachingTxId, setAttachingTxId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTxRef = useRef<TransactionRow | null>(null);

  useEffect(() => {
    supabase
      .from("statement_periods")
      .select("id, name, is_current")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setPeriods(data);
          const current = data.find((p) => p.is_current);
          if (current) setPeriodFilter(current.id);
        }
      });
  }, []);

  const fetchTransactions = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    let query = supabase
      .from("transactions")
      .select("id, transaction_date, vendor_raw, vendor_normalized, amount, card_last_four, match_status, statement_period_id")
      .eq("user_id", user.id)
      .order("transaction_date", { ascending: false });

    if (periodFilter && periodFilter !== "all") {
      query = query.eq("statement_period_id", periodFilter);
    }
    if (matchFilter !== "all") {
      query = query.eq("match_status", matchFilter);
    }

    const { data, error } = await query;
    if (!error && data) {
      setTransactions(data as TransactionRow[]);
      const ids = data.map((t) => t.id);
      if (ids.length > 0) {
        const { data: receipts } = await supabase
          .from("receipts")
          .select("transaction_id")
          .in("transaction_id", ids);
        if (receipts) {
          setLinkedTxIds(new Set(receipts.map((r) => r.transaction_id!).filter(Boolean)));
        }
      } else {
        setLinkedTxIds(new Set());
      }
    }
    setLoading(false);
  }, [user, periodFilter, matchFilter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleAttachReceipt = (tx: TransactionRow) => {
    pendingTxRef.current = tx;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const tx = pendingTxRef.current;
    if (!file || !tx || !user) return;
    e.target.value = "";

    setAttachingTxId(tx.id);
    try {
      const compressed = await compressImage(file);
      const monthFolder = format(new Date(), "yyyy-MM");
      const storagePath = `receipts/${user.id}/${monthFolder}/${uuidv4()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(storagePath, compressed, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(storagePath);

      // Create receipt linked directly to this transaction
      const { error: insertError } = await supabase.from("receipts").insert({
        user_id: user.id,
        photo_url: urlData.publicUrl,
        storage_path: storagePath,
        vendor_confirmed: tx.vendor_normalized ?? tx.vendor_raw ?? null,
        amount_confirmed: tx.amount ?? null,
        date_confirmed: tx.transaction_date ?? null,
        transaction_id: tx.id,
        match_status: "matched",
        match_confidence: 1,
        status: "pending",
      });
      if (insertError) throw insertError;

      // Mark transaction as matched
      await supabase
        .from("transactions")
        .update({ match_status: "matched", match_confidence: 1 })
        .eq("id", tx.id);

      toast.success("Receipt attached!");
      setLinkedTxIds((prev) => new Set([...prev, tx.id]));
      setTransactions((prev) =>
        prev.map((t) => (t.id === tx.id ? { ...t, match_status: "matched" } : t)),
      );
    } catch (err: any) {
      toast.error(err.message ?? "Failed to attach receipt");
    } finally {
      setAttachingTxId(null);
      pendingTxRef.current = null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Transactions</h1>
        <p className="text-muted-foreground text-sm">View card transactions assigned to you.</p>
      </div>

      {/* Hidden file input for attach receipt */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div className="flex flex-wrap gap-3">
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Statement period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All periods</SelectItem>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={matchFilter} onValueChange={setMatchFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Match status" />
          </SelectTrigger>
          <SelectContent>
            {MATCH_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <FileText className="h-10 w-10" />
            <p className="text-sm">No transactions found for this period.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Card</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm">{t.transaction_date ?? "—"}</TableCell>
                  <TableCell className="text-sm font-medium truncate max-w-[200px]">
                    {t.vendor_normalized ?? t.vendor_raw ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right font-medium">
                    {t.amount != null ? `$${t.amount.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">
                    {t.card_last_four ? `•••• ${t.card_last_four}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${matchColor[t.match_status] ?? ""}`}>
                      {t.match_status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {linkedTxIds.has(t.id) ? (
                      <span className="flex items-center gap-1 text-accent">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="text-xs hidden sm:inline">Receipt</span>
                      </span>
                    ) : t.match_status === "unmatched" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        disabled={attachingTxId === t.id}
                        onClick={() => handleAttachReceipt(t)}
                      >
                        {attachingTxId === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Paperclip className="h-3 w-3" />
                        )}
                        Attach
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default EmployeeTransactions;
