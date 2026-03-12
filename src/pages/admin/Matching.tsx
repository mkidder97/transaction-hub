import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  MoreHorizontal,
  Zap,
  FileCheck,
  AlertTriangle,
  FileX,
  Files,
  CreditCard,
  CheckCircle,
  XCircle,
  X,
  Search,
  Unlink,
  Flag,
  Image,
  ImageOff,
  Download,
  Lock,
  ExternalLink,
  Copy,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { generateReconciliationPdf } from "@/lib/generateReconciliationPdf";
import { runMatchingForPeriod } from "@/lib/matcher";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { detectDuplicatesForPeriod, DuplicateGroup } from "@/lib/duplicateDetector";
import { generatePlaceholderReceipt } from "@/lib/generatePlaceholderReceipt";

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
  storage_path: string | null;
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

/* ── Receipt thumbnail helper (signed URL) ───────────────────────── */
function ReceiptThumb({
  storagePath,
  onClick,
  size = 40,
}: {
  storagePath: string | null;
  onClick: (url: string) => void;
  size?: number;
}) {
  const url = useSignedUrl(storagePath);

  if (!storagePath || !url) {
    return (
      <div
        className="rounded bg-muted flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Receipt"
      className="rounded object-cover cursor-pointer hover:ring-2 ring-primary/40 transition-shadow"
      style={{ width: size, height: size }}
      onClick={() => onClick(url)}
    />
  );
}

/* ── Review card thumbnail (signed URL) ──────────────────────────── */
function ReviewCardThumb({
  storagePath,
  onOpen,
}: {
  storagePath: string | null;
  onOpen: (url: string) => void;
}) {
  const url = useSignedUrl(storagePath);
  if (!storagePath || !url) return null;
  return (
    <div className="mb-2">
      <img
        src={url}
        alt="Receipt"
        className="w-full max-h-[120px] object-contain rounded cursor-pointer hover:ring-2 ring-primary/40 transition-shadow"
        onClick={() => onOpen(url)}
      />
      <Button
        size="sm"
        variant="ghost"
        className="text-xs h-6 mt-1 gap-1 text-muted-foreground"
        onClick={() => onOpen(url)}
      >
        <ExternalLink className="h-3 w-3" /> View Receipt
      </Button>
    </div>
  );
}

/* ── Extracted indicator ─────────────────────────────────────────── */
function ExtractedIndicator({ receipt }: { receipt: ReceiptRow }) {
  const hasData = !!(receipt.vendor_extracted || receipt.vendor_confirmed);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            {hasData ? (
              <CheckCircle className="h-4 w-4 text-accent" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {hasData ? "AI extraction complete" : "AI extraction pending"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ── Component ───────────────────────────────────────────────────── */
const Matching = () => {
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

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // All receipts
  const [allReceipts, setAllReceipts] = useState<ReceiptRow[]>([]);
  const [allLoading, setAllLoading] = useState(false);

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

  // Duplicates
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);

  // Legacy tx fetch cache for needs_review cards with transaction_id but no suggestions
  const [legacyTxCache, setLegacyTxCache] = useState<Record<string, { id: string; vendor_normalized: string | null; vendor_raw: string | null; amount: number | null; transaction_date: string | null }>>({});

  // Search modal
  const [searchModal, setSearchModal] = useState<{ type: "receipt" | "transaction"; sourceId: string } | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchVendor, setSearchVendor] = useState("");
  const [searchAmountMin, setSearchAmountMin] = useState("");
  const [searchAmountMax, setSearchAmountMax] = useState("");

  // Inline filter bar state
  const [filterVendor, setFilterVendor] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState<{ id: string; name: string }[]>([]);

  // Flag dialog state
  const [flagReceiptId, setFlagReceiptId] = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  /* ── Fetch vendor & employee options ────────────────────────── */
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
    // Fetch periods and employees in parallel
    Promise.all([
      supabase
        .from("statement_periods")
        .select("id, name, is_current, is_closed")
        .order("start_date", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name"),
    ]).then(([periodsRes, employeesRes]) => {
      if (periodsRes.data) {
        setPeriods(periodsRes.data as Period[]);
        const current = periodsRes.data.find((p) => p.is_current);
        if (current) setPeriodId(current.id);
      }
      if (employeesRes.data) {
        setEmployeeOptions(
          employeesRes.data
            .filter((e) => e.full_name)
            .map((e) => ({ id: e.id, name: e.full_name! }))
        );
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
      supabase.from("receipts").select("match_status, duplicate_status").eq("statement_period_id", pid),
      supabase.from("transactions").select("match_status").eq("statement_period_id", pid),
    ]);

    const r = receipts ?? [];
    const t = txs ?? [];

    setStats({
      total: r.length,
      matched: r.filter((x) => x.match_status === "auto_matched" || x.match_status === "manual_match" || x.match_status === "matched").length,
      autoMatched: r.filter((x) => x.match_status === "auto_matched").length,
      needsReview: r.filter((x) => x.match_status === "needs_review").length,
      unmatched: r.filter((x: any) => x.match_status === "unmatched" && x.duplicate_status !== "confirmed_duplicate").length,
      txWithoutReceipt: t.filter((x) => x.match_status === "unmatched").length,
    });
    setStatsLoading(false);
  }, []);

  /* ── Fetch tab data ─────────────────────────────────────────── */
  const selectFields = "id, storage_path, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, match_suggestions, transaction_id, ai_confidence, photo_url, user_id";

  const fetchAll = useCallback(async (pid: string) => {
    setAllLoading(true);
    const { data } = await supabase
      .from("receipts")
      .select(`${selectFields}, employee:profiles!receipts_user_id_fkey(full_name), transaction:transactions!receipts_transaction_id_fkey(id, vendor_normalized, vendor_raw, amount, transaction_date)`)
      .eq("statement_period_id", pid)
      .order("created_at", { ascending: false });
    setAllReceipts((data as unknown as ReceiptRow[]) ?? []);
    setAllLoading(false);
  }, []);

  const fetchReview = useCallback(async (pid: string) => {
    setReviewLoading(true);
    const { data } = await supabase
      .from("receipts")
      .select(`${selectFields}, employee:profiles!receipts_user_id_fkey(full_name)`)
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
      .select(`${selectFields}, employee:profiles!receipts_user_id_fkey(full_name)`)
      .eq("statement_period_id", pid)
      .eq("match_status", "unmatched")
      .or("duplicate_status.is.null,duplicate_status.neq.confirmed_duplicate")
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
      .select(`${selectFields}, employee:profiles!receipts_user_id_fkey(full_name), transaction:transactions!receipts_transaction_id_fkey(id, vendor_normalized, vendor_raw, amount, transaction_date)`)
      .eq("statement_period_id", pid)
      .in("match_status", ["auto_matched", "manual_match", "matched"])
      .order("match_confidence", { ascending: false });
    setMatchedReceipts((data as unknown as ReceiptRow[]) ?? []);
    setMatchedLoading(false);
  }, []);

  const fetchDuplicates = useCallback(async (pid: string) => {
    setDuplicatesLoading(true);
    const groups = await detectDuplicatesForPeriod(pid);
    setDuplicateGroups(groups);
    setDuplicatesLoading(false);
  }, []);

  const refreshAll = useCallback((pid: string) => {
    fetchStats(pid);
    fetchAll(pid);
    fetchReview(pid);
    fetchUnmatched(pid);
    fetchOrphans(pid);
    fetchMatched(pid);
    fetchDuplicates(pid);
  }, [fetchStats, fetchAll, fetchReview, fetchUnmatched, fetchOrphans, fetchMatched, fetchDuplicates]);

  useEffect(() => {
    if (periodId) refreshAll(periodId);
  }, [periodId, refreshAll]);

  // Fetch legacy transactions for needs_review cards with transaction_id but no suggestions
  useEffect(() => {
    const legacyReceipts = reviewReceipts.filter(
      (r) => (!r.match_suggestions || (r.match_suggestions as MatchSuggestion[]).length === 0) && r.transaction_id
    );
    if (legacyReceipts.length === 0) return;

    const txIds = legacyReceipts.map((r) => r.transaction_id!).filter((id) => !legacyTxCache[id]);
    if (txIds.length === 0) return;

    supabase
      .from("transactions")
      .select("id, vendor_normalized, vendor_raw, amount, transaction_date")
      .in("id", txIds)
      .then(({ data }) => {
        if (data) {
          const cache: typeof legacyTxCache = {};
          for (const tx of data) {
            cache[tx.id] = tx as any;
          }
          setLegacyTxCache((prev) => ({ ...prev, ...cache }));
        }
      });
  }, [reviewReceipts]);

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

  /* ── Duplicate handlers ─────────────────────────────────────── */
  const confirmDuplicate = async (duplicateId: string, originalId: string) => {
    await supabase
      .from("receipts")
      .update({
        duplicate_status: "confirmed_duplicate",
        duplicate_of_id: originalId,
      } as any)
      .eq("id", duplicateId);
    toast.success("Marked as duplicate");
    refreshAll(periodId);
  };

  const dismissDuplicate = async (duplicateId: string, originalId: string) => {
    await supabase
      .from("receipts")
      .update({ duplicate_status: "not_duplicate" } as any)
      .in("id", [duplicateId, originalId]);
    toast.success("Dismissed — kept both");
    refreshAll(periodId);
  };

  /* ── Approve / Flag receipt ─────────────────────────────────── */
  const handleApprove = async (receiptId: string) => {
    const { error } = await supabase
      .from("receipts")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", receiptId);
    if (error) {
      toast.error("Failed to approve receipt");
      return;
    }
    toast.success("Receipt approved");
    refreshAll(periodId);
  };

  /* ── Approve All matched receipts ───────────────────────────── */
  const [approvingAll, setApprovingAll] = useState(false);
  const handleApproveAll = async () => {
    const toApprove = allReceipts.filter(
      (r) =>
        ["auto_matched", "manual_match", "matched"].includes(r.match_status) &&
        r.status !== "approved"
    );
    if (toApprove.length === 0) {
      toast.info("No matched receipts to approve");
      return;
    }
    setApprovingAll(true);
    const { error } = await supabase
      .from("receipts")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .in("id", toApprove.map((r) => r.id));
    setApprovingAll(false);
    if (error) {
      toast.error("Failed to approve receipts");
      return;
    }
    toast.success(`${toApprove.length} receipt${toApprove.length === 1 ? "" : "s"} approved`);
    refreshAll(periodId);
  };

  const handleFlag = async () => {
    if (!flagReceiptId) return;
    setFlagSubmitting(true);
    const { error } = await supabase
      .from("receipts")
      .update({ status: "flagged", flag_reason: flagReason, reviewed_at: new Date().toISOString() })
      .eq("id", flagReceiptId);
    setFlagSubmitting(false);
    if (error) {
      toast.error("Failed to flag receipt");
      return;
    }
    toast.success("Receipt flagged");
    setFlagReceiptId(null);
    setFlagReason("");
    refreshAll(periodId);
  };

  /* ── Receipt actions dropdown ───────────────────────────────── */
  const ReceiptActionsMenu = ({ receiptId, status }: { receiptId: string; status: string }) => {
    if (isClosed) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => handleApprove(receiptId)}
            disabled={status === "approved"}
          >
            <CheckCircle className="h-4 w-4 mr-2 text-accent" />
            Approve
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => { setFlagReceiptId(receiptId); setFlagReason(""); }}
            disabled={status === "flagged"}
          >
            <Flag className="h-4 w-4 mr-2 text-destructive" />
            Flag
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /* ── Search modal helpers ───────────────────────────────────── */
  const openSearchTx = (receiptId: string) => {
    const receipt = [...unmatchedReceipts, ...reviewReceipts, ...allReceipts].find(r => r.id === receiptId);
    const vendor = receipt ? (receipt.vendor_confirmed ?? receipt.vendor_extracted ?? "") : "";
    const amount = receipt ? (receipt.amount_confirmed ?? receipt.amount_extracted) : null;
    const tolerance = 0.5;

    setSearchVendor(vendor);
    setSearchAmountMin(amount != null ? String(Math.max(0, amount - tolerance)) : "");
    setSearchAmountMax(amount != null ? String(amount + tolerance) : "");
    setSearchResults([]);
    setSearchModal({ type: "transaction", sourceId: receiptId });
  };

  const openSearchReceipt = (txId: string) => {
    setSearchVendor("");
    setSearchAmountMin("");
    setSearchAmountMax("");
    setSearchResults([]);
    setSearchModal({ type: "receipt", sourceId: txId });
  };

  // Auto-run search when modal opens with pre-filled data
  useEffect(() => {
    if (searchModal && (searchVendor || searchAmountMin || searchAmountMax)) {
      runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchModal]);

  const runSearch = async () => {
    if (!searchModal || !periodId) return;
    setSearchLoading(true);

    if (searchModal.type === "transaction") {
      const sourceReceipt = [...unmatchedReceipts, ...reviewReceipts, ...allReceipts].find(
        (r) => r.id === searchModal.sourceId,
      );
      const sourceDate = sourceReceipt
        ? (sourceReceipt.date_confirmed ?? sourceReceipt.date_extracted)
        : null;

      let q = supabase
        .from("transactions")
        .select("id, vendor_raw, vendor_normalized, amount, transaction_date")
        .eq("statement_period_id", periodId)
        .eq("match_status", "unmatched")
        .order("transaction_date", { ascending: false })
        .limit(20);

      // Keep “Use Different” focused on likely matches when receipt date exists.
      if (sourceDate) {
        const base = new Date(`${sourceDate}T00:00:00Z`);
        if (!Number.isNaN(base.getTime())) {
          const min = new Date(base);
          min.setUTCDate(base.getUTCDate() - 3);
          const max = new Date(base);
          max.setUTCDate(base.getUTCDate() + 3);
          q = q
            .gte("transaction_date", min.toISOString().slice(0, 10))
            .lte("transaction_date", max.toISOString().slice(0, 10));
        }
      }

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
    { label: "Total Receipts", value: stats.total, icon: <Files className="h-5 w-5" />, color: "text-foreground", tab: "all" },
    { label: "Matched", value: stats.matched, icon: <FileCheck className="h-5 w-5" />, color: "text-accent", tab: "matched" },
    { label: "Needs Review", value: stats.needsReview, icon: <AlertTriangle className="h-5 w-5" />, color: "text-warning", tab: "needs-review" },
    { label: "No Match", value: stats.unmatched, icon: <FileX className="h-5 w-5" />, color: "text-destructive", tab: "unmatched" },
    { label: "Tx Without Receipt", value: stats.txWithoutReceipt, icon: <CreditCard className="h-5 w-5" />, color: "text-muted-foreground", tab: "no-receipt" },
    { label: "Suspected Duplicates", value: duplicateGroups.length, icon: <Copy className="h-5 w-5" />, color: "text-orange-500", tab: "duplicates" },
  ];

  // Count receipts missing extraction in unmatched tab
  const missingExtractionCount = unmatchedReceipts.filter(
    (r) => !r.vendor_extracted && !r.vendor_confirmed
  ).length;

  // Inline filter helpers
  const vendorLower = filterVendor.toLowerCase();

  const matchesVendorR = (r: ReceiptRow) =>
    !filterVendor || (rv(r).toLowerCase().includes(vendorLower));
  const activeEmp = filterEmployee && filterEmployee !== "all" ? filterEmployee.toLowerCase() : "";
  const matchesEmpR = (r: ReceiptRow) =>
    !activeEmp || (r.employee?.full_name?.toLowerCase().includes(activeEmp) ?? false);
  const matchesVendorTx = (tx: TxRow) =>
    !filterVendor || ((tx.vendor_normalized ?? tx.vendor_raw ?? "").toLowerCase().includes(vendorLower));
  const matchesEmpTx = (tx: TxRow) =>
    !activeEmp || (tx.user?.full_name?.toLowerCase().includes(activeEmp) ?? false);

  const filteredAll = allReceipts.filter((r) => matchesVendorR(r) && matchesEmpR(r));
  const filteredReview = reviewReceipts.filter((r) => matchesVendorR(r));
  const filteredUnmatched = unmatchedReceipts.filter((r) => matchesVendorR(r) && matchesEmpR(r));
  const filteredOrphans = orphanTxs.filter((tx) => matchesVendorTx(tx) && matchesEmpTx(tx));
  const filteredMatched = matchedReceipts.filter((r) => matchesVendorR(r) && matchesEmpR(r));

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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {statCards.map((s) => (
          <Card
            key={s.label}
            className={`cursor-pointer transition-all hover:border-primary/40 ${
              activeTab === s.tab
                ? "ring-2 ring-primary border-primary shadow-sm"
                : ""
            }`}
            onClick={() => {
              setActiveTab(s.tab);
              setSearchParams({ tab: s.tab });
              setFilterVendor("");
              setFilterEmployee("");
            }}
          >
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

      {/* Filter / search bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground min-w-fit">
          {statCards.find((s) => s.tab === activeTab)?.icon}
          <span>{statCards.find((s) => s.tab === activeTab)?.label}</span>
        </div>
        <Separator orientation="vertical" className="h-6 hidden sm:block" />

        {/* Vendor search */}
        <div className="relative min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter by vendor…"
            value={filterVendor}
            onChange={(e) => setFilterVendor(e.target.value)}
            className="h-8 pl-8 pr-8 text-sm"
          />
          {filterVendor && (
            <button
              onClick={() => setFilterVendor("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Employee dropdown */}
        {(activeTab === "all" || activeTab === "unmatched" || activeTab === "matched" || activeTab === "no-receipt") && (
          <Select value={filterEmployee} onValueChange={setFilterEmployee}>
            <SelectTrigger className="h-8 text-sm w-[180px]">
              <SelectValue placeholder="All employees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employeeOptions.map((e) => (
                <SelectItem key={e.id} value={e.name}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(filterVendor || (filterEmployee && filterEmployee !== "all")) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterVendor(""); setFilterEmployee(""); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Tab content (no visible tab strip) */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v);
          setSearchParams({ tab: v });
        }}
      >

        {/* ── Tab: All Receipts ────────────────────────────────── */}
        <TabsContent value="all">
          {allLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : filteredAll.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <Files className="h-10 w-10" />
                <p className="text-sm">No receipts in this period.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Photo</TableHead>
                    <TableHead className="w-10">AI</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Matched Tx</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAll.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <ReceiptThumb storagePath={r.storage_path} onClick={setLightboxUrl} />
                      </TableCell>
                      <TableCell>
                        <ExtractedIndicator receipt={r} />
                      </TableCell>
                      <TableCell className="text-sm">{r.employee?.full_name ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{rv(r)}</TableCell>
                      <TableCell className="text-sm text-right font-medium">{fmt(ra(r))}</TableCell>
                      <TableCell className="text-sm">{rd(r) ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-1.5 py-0 ${
                            r.match_status === "matched" || r.match_status === "auto_matched" || r.match_status === "manual_match"
                              ? "bg-accent/15 text-accent"
                              : r.match_status === "needs_review"
                              ? "bg-warning/15 text-warning"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {r.match_status === "auto_matched" ? "Auto" : r.match_status === "manual_match" ? "Manual" : r.match_status === "matched" ? "Matched" : r.match_status === "needs_review" ? "Review" : "Unmatched"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.transaction ? (
                          <span>{r.transaction.vendor_normalized ?? r.transaction.vendor_raw ?? "—"} · {fmt(r.transaction.amount ?? null)}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <ReceiptActionsMenu receiptId={r.id} status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 1: Needs Review ──────────────────────────────── */}
        <TabsContent value="needs-review">
          {reviewLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-lg" />)}</div>
          ) : filteredReview.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="h-10 w-10" />
                <p className="text-sm">No receipts need review.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredReview.map((r) => {
                const suggestions = (r.match_suggestions ?? []) as MatchSuggestion[];
                const legacyTx = suggestions.length === 0 && r.transaction_id ? legacyTxCache[r.transaction_id] : null;

                return (
                  <Card key={r.id}>
                    <CardContent className="p-4">
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Left: receipt info + thumbnail */}
                        <div className="space-y-2">
                          <ReviewCardThumb storagePath={r.storage_path} onOpen={setLightboxUrl} />
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

                          {suggestions.length > 0 ? (
                            <div className="space-y-2">
                              {suggestions.map((s) => (
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
                          ) : legacyTx ? (
                            /* Legacy data: transaction_id set but no suggestions stored */
                            <div className="space-y-2">
                              <div className="flex items-center justify-between border rounded-md p-2 text-sm border-warning/30">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground">
                                      —
                                    </Badge>
                                    <span className="font-medium truncate">{legacyTx.vendor_normalized ?? legacyTx.vendor_raw ?? "—"}</span>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    {fmt(legacyTx.amount)} · {legacyTx.transaction_date ?? "—"}
                                  </div>
                                </div>
                                {!isClosed && (
                                  <Button size="sm" variant="outline" className="ml-2 h-7 text-xs" onClick={() => confirmMatch(r.id, legacyTx.id, r.match_confidence ?? 0)}>
                                    <CheckCircle className="h-3 w-3 mr-1" /> Confirm
                                  </Button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">No candidates stored.</p>
                          )}

                          {isClosed ? (
                            <Badge variant="secondary" className="text-[10px] gap-1"><Lock className="h-3 w-3" /> Locked</Badge>
                          ) : (
                            <div className="flex gap-2 mt-2 flex-wrap">
                              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openSearchTx(r.id)}>
                                <Search className="h-3 w-3 mr-1" /> Use Different
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive" onClick={() => markNoMatch(r.id)}>
                                <XCircle className="h-3 w-3 mr-1" /> No Match
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => handleApprove(r.id)} disabled={r.status === "approved"}>
                                <CheckCircle className="h-3 w-3 mr-1 text-accent" /> Approve
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setFlagReceiptId(r.id); setFlagReason(""); }} disabled={r.status === "flagged"}>
                                <Flag className="h-3 w-3 mr-1 text-destructive" /> Flag
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

        {/* ── Tab 2: No Match Found ────────────────────────────── */}
        <TabsContent value="unmatched">
          {unmatchedLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : filteredUnmatched.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="h-10 w-10" />
                <p className="text-sm">All receipts have candidates or are matched.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Missing extraction banner */}
              {missingExtractionCount > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{missingExtractionCount} receipt(s) are missing AI extraction — they cannot be matched until vendor and amount are read. Open each receipt and use "Parse with AI" to extract the data.</span>
                </div>
              )}

              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Photo</TableHead>
                      <TableHead className="w-10">AI</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="w-32" />
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnmatched.map((r) => {
                      const missingExtraction = !r.vendor_extracted && !r.vendor_confirmed;
                      return (
                        <TableRow key={r.id} className={missingExtraction ? "border-l-2 border-l-warning" : ""}>
                          <TableCell>
                            <ReceiptThumb storagePath={r.storage_path} onClick={setLightboxUrl} />
                          </TableCell>
                          <TableCell>
                            <ExtractedIndicator receipt={r} />
                          </TableCell>
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
                          <TableCell>
                            <ReceiptActionsMenu receiptId={r.id} status={r.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 3: Tx Missing Receipt ────────────────────────── */}
        <TabsContent value="no-receipt">
          {orphanLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : filteredOrphans.length === 0 ? (
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
                  {filteredOrphans.map((tx) => (
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
                            <Button size="sm" variant="ghost" className="text-xs h-7 text-muted-foreground" onClick={() => generatePlaceholderReceipt({ ...tx, employeeName: tx.user?.full_name ?? null, periodName: selectedPeriod?.name ?? null })}>
                              <FileDown className="h-3 w-3 mr-1" /> Placeholder
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

        {/* ── Tab 4: Matched ───────────────────────────────────── */}
        <TabsContent value="matched">
          {matchedLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : filteredMatched.length === 0 ? (
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
                    <TableHead className="w-12">Photo</TableHead>
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
                  {filteredMatched.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <ReceiptThumb storagePath={r.storage_path} onClick={setLightboxUrl} />
                      </TableCell>
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
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => unmatch(r.id, r.transaction_id)}>
                              <Unlink className="h-3 w-3" />
                            </Button>
                            <ReceiptActionsMenu receiptId={r.id} status={r.status} />
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

        {/* ── Tab 5: Duplicates ────────────────────────────────── */}
        <TabsContent value="duplicates">
          {duplicatesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          ) : duplicateGroups.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
                <CheckCircle className="h-10 w-10" />
                <p className="text-sm">No suspected duplicates found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-orange-400/40 bg-orange-50/50 dark:bg-orange-950/20 p-3 text-sm text-muted-foreground flex items-start gap-2">
                <Copy className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
                <span>
                  These receipts share the same amount, date, and/or vendor and may have been submitted twice. Review each pair and confirm the duplicate or keep both.
                </span>
              </div>

              {duplicateGroups.map((group, idx) => (
                <Card key={idx} className="border-orange-400/30">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="secondary"
                        className={
                          group.confidence === "high"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-warning/15 text-warning"
                        }
                      >
                        {group.confidence === "high"
                          ? "High confidence duplicate"
                          : "Possible duplicate"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {group.matchReasons.join(" · ")}
                      </span>
                    </div>

                    <Separator />

                    <div className="grid md:grid-cols-2 gap-4">
                      {/* Original */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-accent">
                          Original (keep)
                        </p>
                        <div className="flex items-start gap-3">
                          <ReceiptThumb
                            storagePath={group.original.storage_path}
                            onClick={setLightboxUrl}
                            size={48}
                          />
                          <div className="text-sm space-y-0.5">
                            <p className="font-medium">
                              {group.original.vendor_confirmed ??
                                group.original.vendor_extracted ??
                                "—"}
                            </p>
                            <p className="text-muted-foreground">
                              {group.original.amount_confirmed != null ||
                              group.original.amount_extracted != null
                                ? `$${Number(
                                    group.original.amount_confirmed ??
                                      group.original.amount_extracted
                                  ).toFixed(2)}`
                                : "—"}{" "}
                              ·{" "}
                              {group.original.date_confirmed ??
                                group.original.date_extracted ??
                                "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {group.original.employee?.full_name ?? "—"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Suspected duplicate */}
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-destructive">
                          Suspected Duplicate (remove?)
                        </p>
                        <div className="flex items-start gap-3">
                          <ReceiptThumb
                            storagePath={group.duplicate.storage_path}
                            onClick={setLightboxUrl}
                            size={48}
                          />
                          <div className="text-sm space-y-0.5">
                            <p className="font-medium">
                              {group.duplicate.vendor_confirmed ??
                                group.duplicate.vendor_extracted ??
                                "—"}
                            </p>
                            <p className="text-muted-foreground">
                              {group.duplicate.amount_confirmed != null ||
                              group.duplicate.amount_extracted != null
                                ? `$${Number(
                                    group.duplicate.amount_confirmed ??
                                      group.duplicate.amount_extracted
                                  ).toFixed(2)}`
                                : "—"}{" "}
                              ·{" "}
                              {group.duplicate.date_confirmed ??
                                group.duplicate.date_extracted ??
                                "—"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {group.duplicate.employee?.full_name ?? "—"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {!isClosed && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="text-xs h-7"
                          onClick={() =>
                            confirmDuplicate(group.duplicate.id, group.original.id)
                          }
                        >
                          <Copy className="h-3 w-3 mr-1" /> Confirm Duplicate
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() =>
                            dismissDuplicate(group.duplicate.id, group.original.id)
                          }
                        >
                          <CheckCircle className="h-3 w-3 mr-1" /> Keep Both
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
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

      {/* ── Image Lightbox ────────────────────────────────────── */}
      <Dialog open={!!lightboxUrl} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-2" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Receipt Image</DialogTitle>
          <img src={lightboxUrl ?? ""} alt="Receipt" className="w-full h-auto rounded-md max-h-[80vh] object-contain" />
        </DialogContent>
      </Dialog>

      {/* ── Flag Dialog ───────────────────────────────────────── */}
      <Dialog open={!!flagReceiptId} onOpenChange={(open) => { if (!open) { setFlagReceiptId(null); setFlagReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Flag Receipt</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Reason for flagging…"
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFlagReceiptId(null); setFlagReason(""); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleFlag} disabled={flagSubmitting || !flagReason.trim()}>
              {flagSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Flag className="h-4 w-4 mr-1" />}
              Flag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Matching;
