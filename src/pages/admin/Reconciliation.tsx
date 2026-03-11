import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { runMatchingForPeriod, type PeriodMatchSummary } from "@/lib/matcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  Zap,
  FileCheck,
  AlertTriangle,
  FileX,
  Files,
  MoreHorizontal,
  CheckCircle,
  Flag,
  Link2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

interface Period {
  id: string;
  name: string;
  is_current: boolean;
  is_closed: boolean;
}

interface Stats {
  total: number;
  matched: number;
  manual_match: number;
  unmatched: number;
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
  transaction_id: string | null;
  user_id: string;
  employee: { full_name: string | null; department: string | null } | null;
  category: { name: string } | null;
  transaction: { vendor_normalized: string | null; amount: number | null; transaction_date: string | null } | null;
}

interface UnmatchedTx {
  id: string;
  vendor_raw: string | null;
  vendor_normalized: string | null;
  amount: number | null;
  transaction_date: string | null;
}

const STATUS_OPTIONS = ["all", "pending", "approved", "flagged"] as const;
const MATCH_OPTIONS = ["all", "unmatched", "matched", "manual_match"] as const;

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  reviewed: "bg-primary/15 text-primary",
  approved: "bg-accent/15 text-accent",
  flagged: "bg-destructive/15 text-destructive",
};

const matchStatusColor: Record<string, string> = {
  unmatched: "bg-warning/15 text-warning",
  matched: "bg-accent/15 text-accent",
  manual_match: "bg-primary/15 text-primary",
};

const Reconciliation = () => {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<PeriodMatchSummary | null>(null);
  const [stats, setStats] = useState<Stats>({ total: 0, matched: 0, manual_match: 0, unmatched: 0 });
  const [statsLoading, setStatsLoading] = useState(false);

  // Table state
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");

  // Flag popover
  const [flagReceiptId, setFlagReceiptId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  // Manual match modal
  const [matchModalReceipt, setMatchModalReceipt] = useState<ReceiptRow | null>(null);
  const [unmatchedTxs, setUnmatchedTxs] = useState<UnmatchedTx[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  // Fetch periods
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

  // Fetch stats
  const fetchStats = useCallback(async (pid: string) => {
    if (!pid) return;
    setStatsLoading(true);
    const { data, error } = await supabase
      .from("receipts")
      .select("match_status")
      .eq("statement_period_id", pid);
    if (!error && data) {
      setStats({
        total: data.length,
        matched: data.filter((r) => r.match_status === "matched").length,
        manual_match: data.filter((r) => r.match_status === "manual_match").length,
        unmatched: data.filter((r) => r.match_status === "unmatched").length,
      });
    }
    setStatsLoading(false);
  }, []);

  // Fetch receipts table
  const fetchReceipts = useCallback(async (pid: string) => {
    if (!pid) return;
    setTableLoading(true);

    let query = supabase
      .from("receipts")
      .select(
        "id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, transaction_id, user_id, employee:profiles!receipts_user_id_fkey(full_name, department), category:expense_categories(name), transaction:transactions!receipts_transaction_id_fkey(vendor_normalized, amount, transaction_date)"
      )
      .eq("statement_period_id", pid)
      .order("created_at", { ascending: false });

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (matchFilter !== "all") query = query.eq("match_status", matchFilter);

    const { data } = await query;
    if (data) setReceipts(data as unknown as ReceiptRow[]);
    setTableLoading(false);
  }, [statusFilter, matchFilter]);

  useEffect(() => {
    if (periodId) {
      fetchStats(periodId);
      fetchReceipts(periodId);
    }
  }, [periodId, fetchStats, fetchReceipts]);

  // Run auto-match
  const handleRunMatch = async () => {
    if (!periodId) return;
    setRunning(true);
    setLastResult(null);
    try {
      const result = await runMatchingForPeriod(periodId);
      setLastResult(result);
      toast.success("Matching complete!");
      fetchStats(periodId);
      fetchReceipts(periodId);
    } catch (err: any) {
      toast.error(err.message ?? "Matching failed");
    } finally {
      setRunning(false);
    }
  };

  // Actions
  const handleApprove = async (receiptId: string) => {
    const { error } = await supabase
      .from("receipts")
      .update({ status: "approved" })
      .eq("id", receiptId);
    if (error) { toast.error("Failed to approve"); return; }
    toast.success("Receipt approved");
    fetchReceipts(periodId);
    fetchStats(periodId);
  };

  const handleFlag = async () => {
    if (!flagReceiptId || !flagReason.trim()) return;
    setFlagSubmitting(true);
    const { error } = await supabase
      .from("receipts")
      .update({ status: "flagged", flag_reason: flagReason.trim() })
      .eq("id", flagReceiptId);
    setFlagSubmitting(false);
    if (error) { toast.error("Failed to flag"); return; }
    toast.success("Receipt flagged");
    setFlagReceiptId(null);
    setFlagReason("");
    fetchReceipts(periodId);
    fetchStats(periodId);
  };

  const openManualMatch = async (receipt: ReceiptRow) => {
    setMatchModalReceipt(receipt);
    setTxLoading(true);
    const { data } = await supabase
      .from("transactions")
      .select("id, vendor_raw, vendor_normalized, amount, transaction_date")
      .eq("user_id", receipt.user_id)
      .eq("match_status", "unmatched")
      .order("transaction_date", { ascending: false });
    setUnmatchedTxs((data as UnmatchedTx[]) ?? []);
    setTxLoading(false);
  };

  const handleManualMatch = async (txId: string) => {
    if (!matchModalReceipt) return;
    const { error: rErr } = await supabase
      .from("receipts")
      .update({ transaction_id: txId, match_status: "manual_match", match_confidence: 1 })
      .eq("id", matchModalReceipt.id);
    const { error: tErr } = await supabase
      .from("transactions")
      .update({ match_status: "matched", match_confidence: 1 })
      .eq("id", txId);
    if (rErr || tErr) { toast.error("Failed to link"); return; }
    toast.success("Manually matched");
    setMatchModalReceipt(null);
    fetchReceipts(periodId);
    fetchStats(periodId);
  };

  const statCards: { label: string; value: number; icon: React.ReactNode; color: string }[] = [
    { label: "Total Receipts", value: stats.total, icon: <Files className="h-5 w-5" />, color: "text-foreground" },
    { label: "Auto-Matched", value: stats.matched, icon: <FileCheck className="h-5 w-5" />, color: "text-accent" },
    { label: "Pending Review", value: stats.manual_match, icon: <AlertTriangle className="h-5 w-5" />, color: "text-warning" },
    { label: "Unmatched", value: stats.unmatched, icon: <FileX className="h-5 w-5" />, color: "text-destructive" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        <p className="text-muted-foreground text-sm">
          Match receipts to transactions and resolve discrepancies.
        </p>
      </div>

      {/* Period selector + Run button */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.is_current ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button className="gap-2" onClick={handleRunMatch} disabled={running || !periodId}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {running ? "Matching receipts to transactions…" : "Run Auto-Match"}
        </Button>
      </div>

      {/* Result summary */}
      {lastResult && !running && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="p-4 text-sm flex items-center gap-4 flex-wrap">
            <span className="font-semibold">Last Run:</span>
            <span className="text-accent font-medium">Matched: {lastResult.matched}</span>
            <span className="text-warning font-medium">Needs Review: {lastResult.needs_review}</span>
            <span className="text-muted-foreground font-medium">No Match: {lastResult.skipped}</span>
          </CardContent>
        </Card>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
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
            <SelectValue placeholder="Match status" />
          </SelectTrigger>
          <SelectContent>
            {MATCH_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all"
                  ? "All match statuses"
                  : s === "manual_match"
                  ? "Needs Review"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reconciliation table */}
      {tableLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
            <Files className="h-10 w-10" />
            <p className="text-sm">No receipts found for this period and filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Receipt Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Matched Tx</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Match</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((r) => {
                const vendor = r.vendor_confirmed ?? r.vendor_extracted ?? "—";
                const amount = r.amount_confirmed ?? r.amount_extracted;
                const date = r.date_confirmed ?? r.date_extracted;
                const txVendor = r.transaction?.vendor_normalized;
                const txAmount = r.transaction?.amount;

                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">
                      <div className="font-medium">{r.employee?.full_name ?? "—"}</div>
                      {r.employee?.department && (
                        <div className="text-[11px] text-muted-foreground">{r.employee.department}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium truncate max-w-[140px]">{vendor}</TableCell>
                    <TableCell className="text-sm text-right font-medium">
                      {amount != null ? `$${amount.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{date ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {r.transaction_id ? (
                        <div>
                          <span className="font-medium">{txVendor ?? "—"}</span>
                          {txAmount != null && (
                            <span className="text-muted-foreground ml-1 text-xs">${txAmount.toFixed(2)}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.match_confidence != null ? `${Math.round(r.match_confidence * 100)}%` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusColor[r.status] ?? ""}`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${matchStatusColor[r.match_status] ?? ""}`}>
                        {r.match_status === "manual_match" ? "needs review" : r.match_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleApprove(r.id)}>
                            <CheckCircle className="h-3.5 w-3.5 mr-2 text-accent" /> Approve
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => { setFlagReceiptId(r.id); setFlagReason(""); }}
                          >
                            <Flag className="h-3.5 w-3.5 mr-2 text-destructive" /> Flag
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openManualMatch(r)}>
                            <Link2 className="h-3.5 w-3.5 mr-2 text-primary" /> Manual Match
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Flag popover as dialog */}
      <Dialog open={!!flagReceiptId} onOpenChange={(open) => { if (!open) setFlagReceiptId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Flag Receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Enter flag reason…"
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setFlagReceiptId(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1"
                disabled={!flagReason.trim() || flagSubmitting}
                onClick={handleFlag}
              >
                {flagSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Flag
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual match modal */}
      <Dialog open={!!matchModalReceipt} onOpenChange={(open) => { if (!open) setMatchModalReceipt(null); }}>
        <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Manual Match — Select Transaction</DialogTitle>
          </DialogHeader>
          {txLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : unmatchedTxs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No unmatched transactions found for this employee.
            </p>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmatchedTxs.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm">{tx.transaction_date ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {tx.vendor_normalized ?? tx.vendor_raw ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        {tx.amount != null ? `$${tx.amount.toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleManualMatch(tx.id)}>
                          <Link2 className="h-3 w-3" /> Link
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reconciliation;
