import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Zap,
  FileCheck,
  AlertTriangle,
  FileX,
  Files,
  CreditCard,
  CheckCircle,
  XCircle,
  Search,
  Unlink,
  Flag,
  Image,
  Download,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { generateReconciliationPdf } from "@/lib/generateReconciliationPdf";
import { runMatchingForPeriod } from "@/lib/matcher";

/* ── Types ───────────────────────────────────────────────────────── */

interface Period {
  id: string;
  name: string;
  is_current: boolean;
  is_closed: boolean;
}

interface Stats {
  total: number;
  matched: number;
  autoMatched: number;
  needsReview: number;
  unmatched: number;
  txWithoutReceipt: number;
}

interface MatchSuggestion {
  transactionId: string;
  vendor: string | null;
  amount: number | null;
  date: string | null;
  score: number;
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
  match_suggestions: MatchSuggestion[] | null;
  transaction_id: string | null;
  ai_confidence: number | null;
  photo_url: string | null;
  user_id: string;
  employee: { full_name: string | null } | null;
  transaction: {
    id: string;
    vendor_normalized: string | null;
    vendor_raw: string | null;
    amount: number | null;
    transaction_date: string | null;
  } | null;
}

interface TxRow {
  id: string;
  vendor_raw: string | null;
  vendor_normalized: string | null;
  amount: number | null;
  transaction_date: string | null;
  card_last_four: string | null;
  match_status: string;
  user: { full_name: string | null } | null;
}

interface BulkResult {
  total: number;
  autoMatched: number;
  needsReview: number;
  noMatch: number;
}

/* ── Score badge color ───────────────────────────────────────────── */
function scoreBadgeClass(score: number): string {
  if (score >= 0.85) return "bg-accent/15 text-accent";
  if (score >= 0.7) return "bg-warning/15 text-warning";
  return "bg-destructive/15 text-destructive";
}

/* ── Component ───────────────────────────────────────────────────── */
const Matching = () => {
  const { } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "needs-review";

  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [stats, setStats] = useState<Stats>({
    total: 0,
    matched: 0,
    autoMatched: 0,
    needsReview: 0,
    unmatched: 0,
    txWithoutReceipt: 0,
  });
  const [statsLoading, setStatsLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);

  // Needs Review
  const [reviewReceipts, setReviewReceipts] = useState<ReceiptRow[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Unmatched
  const [unmatchedReceipts, setUnmatchedReceipts] = useState<ReceiptRow[]>([]);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);

  // Tx without receipt
  const [orphanTxs, setOrphanTxs] = useState<TxRow[]>([]);
  const [orphanLoading, setOrphanLoading] = useState(false);

  // Matched
  const [matchedReceipts, setMatchedReceipts] = useState<ReceiptRow[]>([]);
  const [matchedLoading, setMatchedLoading] = useState(false);

  // Search modal
  const [searchModal, setSearchModal] = useState<{ type: "receipt" | "transaction"; sourceId: string } | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchVendor, setSearchVendor] = useState("");
  const [searchAmountMin, setSearchAmountMin] = useState("");
  const [searchAmountMax, setSearchAmountMax] = useState("");

  /* ── Fetch periods ──────────────────────────────────────────── */
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
    supabase
      .from("statement_periods")
      .select("id, name, is_current, is_closed")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setPeriods(data as Period[]);
          const current = data.find((p) => p.is_current);
          if (current) setPeriodId(current.id);
        }
      });
  }, []);

  const selectedPeriod = periods.find((p) => p.id === periodId);
  const isClosed = selectedPeriod?.is_closed ?? false;

  const handleDownloadReport = async () => {
    if (!periodId) return;
    setPdfGenerating(true);
    try {
      await generateReconciliationPdf(periodId);
      toast.success("Report downloaded");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to generate report");
    } finally {
      setPdfGenerating(false);
    }
  };

  /* ── Fetch stats ────────────────────────────────────────────── */
  const fetchStats = useCallback(async (pid: string) => {
    if (!pid) return;
    setStatsLoading(true);

    const [{ data: receipts }, { data: txs }] = await Promise.all([
      supabase.from("receipts").select("match_status").eq("statement_period_id", pid),
      supabase.from("transactions").select("match_status").eq("statement_period_id", pid),
    ]);

    const r = receipts ?? [];
    const t = txs ?? [];

    setStats({
      total: r.length,
      matched: r.filter((x) => x.match_status === "auto_matched" || x.match_status === "manual_match" || x.match_status === "matched").length,
      autoMatched: r.filter((x) => x.match_status === "auto_matched").length,
      needsReview: r.filter((x) => x.match_status === "needs_review").length,
      unmatched: r.filter((x) => x.match_status === "unmatched").length,
      txWithoutReceipt: t.filter((x) => x.match_status === "unmatched").length,
    });
    setStatsLoading(false);
  }, []);

  /* ── Fetch tab data ─────────────────────────────────────────── */
  const fetchReview = useCallback(async (pid: string) => {
    setReviewLoading(true);
    const { data } = await supabase
      .from("receipts")
      .select("id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, match_suggestions, transaction_id, ai_confidence, photo_url, user_id, employee:profiles!receipts_user_id_fkey(full_name)")
      .eq("statement_period_id", pid)
      .eq("match_status", "needs_review")
      .order("match_confidence", { ascending: false });
    setReviewReceipts((data as unknown as ReceiptRow[]) ?? []);
    setReviewLoading(false);
  }, []);

  const fetchUnmatched = useCallback(async (pid: string) => {
    setUnmatchedLoading(true);
    const { data } = await supabase
      .from("receipts")
      .select("id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, match_suggestions, transaction_id, ai_confidence, photo_url, user_id, employee:profiles!receipts_user_id_fkey(full_name)")
      .eq("statement_period_id", pid)
      .eq("match_status", "unmatched")
      .order("created_at", { ascending: false });
    setUnmatchedReceipts((data as unknown as ReceiptRow[]) ?? []);
    setUnmatchedLoading(false);
  }, []);

  const fetchOrphans = useCallback(async (pid: string) => {
    setOrphanLoading(true);
    const { data } = await supabase
      .from("transactions")
      .select("id, vendor_raw, vendor_normalized, amount, transaction_date, card_last_four, match_status, user:profiles!transactions_user_id_fkey(full_name)")
      .eq("statement_period_id", pid)
      .eq("match_status", "unmatched")
      .order("transaction_date", { ascending: false });
    setOrphanTxs((data as unknown as TxRow[]) ?? []);
    setOrphanLoading(false);
  }, []);

  const fetchMatched = useCallback(async (pid: string) => {
    setMatchedLoading(true);
    const { data } = await supabase
      .from("receipts")
      .select("id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, match_suggestions, transaction_id, ai_confidence, photo_url, user_id, employee:profiles!receipts_user_id_fkey(full_name), transaction:transactions!receipts_transaction_id_fkey(id, vendor_normalized, vendor_raw, amount, transaction_date)")
      .eq("statement_period_id", pid)
      .in("match_status", ["auto_matched", "manual_match", "matched"])
      .order("match_confidence", { ascending: false });
    setMatchedReceipts((data as unknown as ReceiptRow[]) ?? []);
    setMatchedLoading(false);
  }, []);

  const refreshAll = useCallback((pid: string) => {
    fetchStats(pid);
    fetchReview(pid);
    fetchUnmatched(pid);
    fetchOrphans(pid);
    fetchMatched(pid);
  }, [fetchStats, fetchReview, fetchUnmatched, fetchOrphans, fetchMatched]);

  useEffect(() => {
    if (periodId) refreshAll(periodId);
  }, [periodId, refreshAll]);

  /* ── Run auto-match ─────────────────────────────────────────── */
  const handleRunMatch = async () => {
    if (!periodId) return;
    setRunning(true);
    setBulkResult(null);
    try {
      const result = await runMatchingForPeriod(periodId);
      setBulkResult({
        total: result.matched + result.needs_review + result.skipped,
        autoMatched: result.matched,
        needsReview: result.needs_review,
        noMatch: result.skipped,
      });
      toast.success("Auto-matching complete!");
      refreshAll(periodId);
    } catch (err: any) {
      toast.error(err.message ?? "Matching failed");
    } finally {
      setRunning(false);
    }
  };

  /* ── Confirm a suggestion ───────────────────────────────────── */
  const confirmMatch = async (receiptId: string, txId: string, score: number) => {
    const { error: rErr } = await supabase
      .from("receipts")
      .update({
        transaction_id: txId,
        match_status: "manual_match",
        match_confidence: score,
        match_suggestions: null,
      })
      .eq("id", receiptId);
    const { error: tErr } = await supabase
      .from("transactions")
      .update({
        receipt_id: receiptId,
        match_status: "matched",
        match_confidence: score,
      })
      .eq("id", txId);
    if (rErr || tErr) {
      toast.error("Failed to confirm match");
      return;
    }
    toast.success("Match confirmed");
    refreshAll(periodId);
  };

  /* ── Mark as no match ───────────────────────────────────────── */
  const markNoMatch = async (receiptId: string) => {
    await supabase
      .from("receipts")
      .update({ match_status: "unmatched", match_suggestions: null, match_confidence: null })
      .eq("id", receiptId);
    toast.success("Moved to unmatched");
    refreshAll(periodId);
  };

  /* ── Unmatch ────────────────────────────────────────────────── */
  const unmatch = async (receiptId: string, txId: string | null) => {
    await supabase
      .from("receipts")
      .update({ match_status: "unmatched", transaction_id: null, match_confidence: null, match_suggestions: null })
      .eq("id", receiptId);
    if (txId) {
      await supabase
        .from("transactions")
        .update({ match_status: "unmatched", receipt_id: null, match_confidence: null })
        .eq("id", txId);
    }
    toast.success("Unmatched");
    refreshAll(periodId);
  };

  /* ── Flag tx as no receipt needed ───────────────────────────── */
  const flagNoReceipt = async (txId: string) => {
    await supabase
      .from("transactions")
      .update({ match_status: "no_receipt", notes: "Flagged as no receipt needed" })
      .eq("id", txId);
    toast.success("Flagged");
    refreshAll(periodId);
  };

  /* ── Search modal helpers ───────────────────────────────────── */
  const openSearchTx = (receiptId: string) => {
    setSearchModal({ type: "transaction", sourceId: receiptId });
    setSearchResults([]);
    setSearchVendor("");
    setSearchAmountMin("");
    setSearchAmountMax("");
  };

  const openSearchReceipt = (txId: string) => {
    setSearchModal({ type: "receipt", sourceId: txId });
    setSearchResults([]);
    setSearchVendor("");
    setSearchAmountMin("");
    setSearchAmountMax("");
  };

  const runSearch = async () => {
    if (!searchModal || !periodId) return;
    setSearchLoading(true);

    if (searchModal.type === "transaction") {
      let q = supabase
        .from("transactions")
        .select("id, vendor_raw, vendor_normalized, amount, transaction_date")
        .eq("statement_period_id", periodId)
        .eq("match_status", "unmatched")
        .order("transaction_date", { ascending: false })
        .limit(20);

      if (searchVendor) q = q.or(`vendor_raw.ilike.%${searchVendor}%,vendor_normalized.ilike.%${searchVendor}%`);
      if (searchAmountMin) q = q.gte("amount", parseFloat(searchAmountMin));
      if (searchAmountMax) q = q.lte("amount", parseFloat(searchAmountMax));

      const { data } = await q;
      setSearchResults(data ?? []);
    } else {
      let q = supabase
        .from("receipts")
        .select("id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, employee:profiles!receipts_user_id_fkey(full_name)")
        .eq("statement_period_id", periodId)
        .eq("match_status", "unmatched")
        .order("created_at", { ascending: false })
        .limit(20);

      if (searchVendor) q = q.or(`vendor_extracted.ilike.%${searchVendor}%,vendor_confirmed.ilike.%${searchVendor}%`);

      const { data } = await q;
      setSearchResults(data ?? []);
    }
    setSearchLoading(false);
  };

  const handleSearchSelect = async (targetId: string) => {
    if (!searchModal) return;
    const { type, sourceId } = searchModal;

    let receiptId: string;
    let txId: string;

    if (type === "transaction") {
      receiptId = sourceId;
      txId = targetId;
    } else {
      receiptId = targetId;
      txId = sourceId;
    }

    await supabase
      .from("receipts")
      .update({ transaction_id: txId, match_status: "manual_match", match_confidence: 1, match_suggestions: null })
      .eq("id", receiptId);
    await supabase
      .from("transactions")
      .update({ receipt_id: receiptId, match_status: "matched", match_confidence: 1 })
      .eq("id", txId);

    toast.success("Manually matched");
    setSearchModal(null);
    refreshAll(periodId);
  };

  /* ── Helpers ────────────────────────────────────────────────── */
  const rv = (r: ReceiptRow) => r.vendor_confirmed ?? r.vendor_extracted ?? "—";
  const ra = (r: ReceiptRow) => r.amount_confirmed ?? r.amount_extracted;
  const rd = (r: ReceiptRow) => r.date_confirmed ?? r.date_extracted;
  const fmt = (n: number | null) => (n != null ? `$${Number(n).toFixed(2)}` : "—");

  const statCards = [
    { label: "Total Receipts", value: stats.total, icon: <Files className="h-5 w-5" />, color: "text-foreground" },
    { label: "Matched", value: stats.matched, icon: <FileCheck className="h-5 w-5" />, color: "text-accent" },
    { label: "Needs Review", value: stats.needsReview, icon: <AlertTriangle className="h-5 w-5" />, color: "text-warning" },
    { label: "No Match", value: stats.unmatched, icon: <FileX className="h-5 w-5" />, color: "text-destructive" },
    { label: "Tx Without Receipt", value: stats.txWithoutReceipt, icon: <CreditCard className="h-5 w-5" />, color: "text-muted-foreground" },
  ];

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transaction Matching</h1>
        <p className="text-muted-foreground text-sm">
          Match receipts to bank transactions automatically and review suggestions.
        </p>
      </div>

      {/* Header: period + run */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isClosed ? (
          <Badge variant="secondary" className="gap-1 py-1.5 px-3">
            <Lock className="h-3.5 w-3.5" /> Period Closed
          </Badge>
        ) : (
          <Button className="gap-2" onClick={handleRunMatch} disabled={running || !periodId}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {running ? "Running…" : "Run Auto-Match"}
          </Button>
        )}

        <Button variant="outline" className="gap-2" onClick={handleDownloadReport} disabled={pdfGenerating || !periodId}>
          {pdfGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download Report
        </Button>
      </div>

      {/* Bulk result summary */}
      {bulkResult && !running && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="p-4 text-sm flex items-center gap-4 flex-wrap">
            <span className="font-semibold">Last Run:</span>
            <span>Total: {bulkResult.total}</span>
            <span className="text-accent font-medium">Auto-Matched: {bulkResult.autoMatched}</span>
            <span className="text-warning font-medium">Needs Review: {bulkResult.needsReview}</span>
            <span className="text-muted-foreground">No Match: {bulkResult.noMatch}</span>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex flex-col gap-1">
              <div className={`flex items-center gap-2 ${s.color}`}>
                {s.icon}
                <span className="text-2xl font-bold">{statsLoading ? "–" : s.value}</span>
              </div>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v);
          setSearchParams({ tab: v });
        }}
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="needs-review">
            Needs Review{stats.needsReview > 0 && ` (${stats.needsReview})`}
          </TabsTrigger>
          <TabsTrigger value="unmatched">
            Unmatched{stats.unmatched > 0 && ` (${stats.unmatched})`}
          </TabsTrigger>
          <TabsTrigger value="no-receipt">
            No Receipt{stats.txWithoutReceipt > 0 && ` (${stats.txWithoutReceipt})`}
          </TabsTrigger>
          <TabsTrigger value="matched">Matched</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Needs Review ──────────────────────────────── */}
        <TabsContent value="needs-review">
          {reviewLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>
          ) : reviewReceipts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="h-10 w-10" />
                <p className="text-sm">No receipts need review.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {reviewReceipts.map((r) => {
                const suggestions = (r.match_suggestions ?? []) as MatchSuggestion[];
                return (
                  <Card key={r.id}>
                    <CardContent className="p-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Left: receipt info */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Image className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Receipt</span>
                          </div>
                          <div className="text-sm space-y-1">
                            <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{rv(r)}</span></div>
                            <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{fmt(ra(r))}</span></div>
                            <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{rd(r) ?? "—"}</span></div>
                            <div><span className="text-muted-foreground">Employee:</span> <span className="font-medium">{r.employee?.full_name ?? "—"}</span></div>
                            {r.ai_confidence != null && (
                              <div><span className="text-muted-foreground">AI Confidence:</span> <span className="font-medium">{Math.round(r.ai_confidence * 100)}%</span></div>
                            )}
                          </div>
                        </div>

                        {/* Right: suggestions */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Candidate Transactions</span>
                          </div>
                          {suggestions.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No candidates stored.</p>
                          ) : (
                            <div className="space-y-2">
                              {suggestions.map((s, i) => (
                                <div key={s.transactionId} className="flex items-center justify-between border rounded-md p-2 text-sm">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${scoreBadgeClass(s.score)}`}>
                                        {Math.round(s.score * 100)}%
                                      </Badge>
                                      <span className="font-medium truncate">{s.vendor ?? "—"}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                      {fmt(s.amount)} · {s.date ?? "—"}
                                    </div>
                                  </div>
                                  {isClosed ? null : (
                                    <Button size="sm" variant="outline" className="ml-2 h-7 text-xs" onClick={() => confirmMatch(r.id, s.transactionId, s.score)}>
                                      <CheckCircle className="h-3 w-3 mr-1" /> Confirm
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {isClosed ? (
                            <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                          ) : (
                            <div className="flex gap-2 mt-2">
                              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openSearchTx(r.id)}>
                                <Search className="h-3 w-3 mr-1" /> Use Different
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={() => markNoMatch(r.id)}>
                                <XCircle className="h-3 w-3 mr-1" /> No Match
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Unmatched Receipts ────────────────────────── */}
        <TabsContent value="unmatched">
          {unmatchedLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : unmatchedReceipts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="h-10 w-10" />
                <p className="text-sm">All receipts have candidates or are matched.</p>
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
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmatchedReceipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{r.employee?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{rv(r)}</TableCell>
                      <TableCell className="text-sm text-right font-medium">{fmt(ra(r))}</TableCell>
                      <TableCell className="text-sm">{rd(r) ?? "—"}</TableCell>
                      <TableCell>
                        {isClosed ? (
                          <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                        ) : (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openSearchTx(r.id)}>
                            <Search className="h-3 w-3 mr-1" /> Find Transaction
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 3: Transactions Without Receipt ──────────────── */}
        <TabsContent value="no-receipt">
          {orphanLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : orphanTxs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="h-10 w-10" />
                <p className="text-sm">All transactions have receipts.</p>
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
                    <TableHead>Card</TableHead>
                    <TableHead className="w-48" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orphanTxs.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm">{tx.user?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{tx.vendor_normalized ?? tx.vendor_raw ?? "—"}</TableCell>
                      <TableCell className="text-sm text-right font-medium">{fmt(tx.amount)}</TableCell>
                      <TableCell className="text-sm">{tx.transaction_date ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{tx.card_last_four ? `•••• ${tx.card_last_four}` : "—"}</TableCell>
                      <TableCell>
                        {isClosed ? (
                          <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                        ) : (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openSearchReceipt(tx.id)}>
                              <Search className="h-3 w-3 mr-1" /> Find Receipt
                            </Button>
                            <Button size="sm" variant="ghost" className="text-xs h-7 text-muted-foreground" onClick={() => flagNoReceipt(tx.id)}>
                              <Flag className="h-3 w-3 mr-1" /> No Receipt
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 4: Matched (read-only) ───────────────────────── */}
        <TabsContent value="matched">
          {matchedLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : matchedReceipts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <FileX className="h-10 w-10" />
                <p className="text-sm">No matched pairs yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Receipt Vendor</TableHead>
                    <TableHead className="text-right">Receipt Amt</TableHead>
                    <TableHead>Tx Vendor</TableHead>
                    <TableHead className="text-right">Tx Amt</TableHead>
                    <TableHead>Tx Date</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchedReceipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm">{r.employee?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{rv(r)}</TableCell>
                      <TableCell className="text-sm text-right">{fmt(ra(r))}</TableCell>
                      <TableCell className="text-sm font-medium">{r.transaction?.vendor_normalized ?? r.transaction?.vendor_raw ?? "—"}</TableCell>
                      <TableCell className="text-sm text-right">{fmt(r.transaction?.amount ?? null)}</TableCell>
                      <TableCell className="text-sm">{r.transaction?.transaction_date ?? "—"}</TableCell>
                      <TableCell>
                        {r.match_confidence != null && (
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${scoreBadgeClass(r.match_confidence)}`}>
                            {Math.round(r.match_confidence * 100)}%
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {r.match_status === "auto_matched" ? "Auto" : "Manual"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isClosed ? (
                          <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => unmatch(r.id, r.transaction_id)}>
                            <Unlink className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Search Modal ──────────────────────────────────────── */}
      <Dialog open={!!searchModal} onOpenChange={(open) => !open && setSearchModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {searchModal?.type === "transaction" ? "Search Transactions" : "Search Receipts"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Vendor" value={searchVendor} onChange={(e) => setSearchVendor(e.target.value)} />
              {searchModal?.type === "transaction" && (
                <>
                  <Input placeholder="Min $" type="number" className="w-24" value={searchAmountMin} onChange={(e) => setSearchAmountMin(e.target.value)} />
                  <Input placeholder="Max $" type="number" className="w-24" value={searchAmountMax} onChange={(e) => setSearchAmountMax(e.target.value)} />
                </>
              )}
              <Button onClick={runSearch} disabled={searchLoading}>
                {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            {searchResults.length > 0 && (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {searchResults.map((item: any) => (
                  <button
                    key={item.id}
                    className="w-full text-left p-2 rounded-md hover:bg-muted text-sm flex justify-between items-center"
                    onClick={() => handleSearchSelect(item.id)}
                  >
                    <div>
                      <span className="font-medium">
                        {item.vendor_normalized ?? item.vendor_raw ?? item.vendor_confirmed ?? item.vendor_extracted ?? "—"}
                      </span>
                      {item.transaction_date && <span className="text-muted-foreground ml-2">{item.transaction_date}</span>}
                      {(item.date_confirmed ?? item.date_extracted) && (
                        <span className="text-muted-foreground ml-2">{item.date_confirmed ?? item.date_extracted}</span>
                      )}
                    </div>
                    <span className="font-medium">
                      {fmt(item.amount ?? item.amount_confirmed ?? item.amount_extracted)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searchResults.length === 0 && !searchLoading && (
              <p className="text-sm text-muted-foreground text-center py-4">Enter filters and search to find matches.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Matching;
