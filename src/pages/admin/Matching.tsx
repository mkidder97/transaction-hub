import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

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
  FileText,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { generateReconciliationPdf } from "@/lib/generateReconciliationPdf";
import { runMatchingForPeriod } from "@/lib/matcher";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { detectDuplicatesForPeriod, DuplicateGroup } from "@/lib/duplicateDetector";
import { buildPlaceholderBlob } from "@/lib/generatePlaceholderReceipt";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  is_placeholder: boolean | null;
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
  user_id: string | null;
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
  noMatch: number;
}

interface MessageTarget {
  id: string;
  user_id: string | null;
  vendor: string;
  amount: number | null;
  date: string | null;
  employeeName: string | null;
  transaction_id?: string;
  receipt_id?: string | null;
}

const PAGE_SIZE = 20;

/* ── Score badge color ───────────────────────────────────────────── */
function scoreBadgeClass(score: number): string {
  if (score >= 0.85) return "bg-accent/15 text-accent";
  if (score >= 0.7) return "bg-warning/15 text-warning";
  return "bg-destructive/15 text-destructive";
}

/* ── Pagination component ────────────────────────────────────────── */
function TablePagination({ page, totalItems, onPageChange }: { page: number; totalItems: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-2 py-3">
      <span className="text-xs text-muted-foreground">
        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalItems)} of {totalItems}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-muted-foreground px-2">
          {page + 1} / {totalPages}
        </span>
        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ── Receipt thumbnail helper (signed URL) ───────────────────────── */
function ReceiptThumb({
  storagePath,
  onClick,
  size = 40,
  isPlaceholder = false,
}: {
  storagePath: string | null;
  onClick: (url: string) => void;
  size?: number;
  isPlaceholder?: boolean;
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

  if (isPlaceholder && url) {
    return (
      <div
        className="rounded bg-muted flex items-center justify-center cursor-pointer hover:ring-2 ring-primary/40 transition-shadow"
        style={{ width: size, height: size }}
        onClick={() => window.open(url, "_blank")}
        title="View placeholder PDF"
      >
        <FileText className="h-4 w-4 text-muted-foreground" />
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
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "unmatched";

  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [stats, setStats] = useState<Stats>({
    total: 0,
    matched: 0,
    autoMatched: 0,
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

  // Placeholder confirmation
  const [placeholderTx, setPlaceholderTx] = useState<TxRow | null>(null);
  const [placeholderLoading, setPlaceholderLoading] = useState(false);

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

  // Message dialog state
  const [messageTx, setMessageTx] = useState<MessageTarget | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  // Pagination state per tab
  const [pageAll, setPageAll] = useState(0);
  const [pageUnmatched, setPageUnmatched] = useState(0);
  const [pageMatched, setPageMatched] = useState(0);
  const [pageOrphans, setPageOrphans] = useState(0);

  // Bulk selection
  const [selectedUnmatched, setSelectedUnmatched] = useState<Set<string>>(new Set());
  const [selectedMatched, setSelectedMatched] = useState<Set<string>>(new Set());
  const [selectedOrphans, setSelectedOrphans] = useState<Set<string>>(new Set());

  // Bulk message dialog
  const [bulkMessageTargets, setBulkMessageTargets] = useState<MessageTarget[]>([]);
  const [bulkMessageText, setBulkMessageText] = useState("");
  const [sendingBulkMessage, setSendingBulkMessage] = useState(false);

  /* ── Fetch vendor & employee options ────────────────────────── */
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
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
      unmatched: r.filter((x: any) => x.match_status === "unmatched" && x.duplicate_status !== "confirmed_duplicate").length,
      txWithoutReceipt: t.filter((x) => x.match_status === "unmatched").length,
    });
    setStatsLoading(false);
  }, []);

  /* ── Fetch tab data ─────────────────────────────────────────── */
  const selectFields = "id, storage_path, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, match_suggestions, transaction_id, ai_confidence, photo_url, user_id, is_placeholder";

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
      .select("id, user_id, vendor_raw, vendor_normalized, amount, transaction_date, card_last_four, match_status, user:profiles!transactions_user_id_fkey(full_name)")
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

  /* ── Targeted refresh helpers ──────────────────────────────── */
  const refreshAll = useCallback((pid: string) => {
    fetchStats(pid);
    fetchAll(pid);
    fetchUnmatched(pid);
    fetchOrphans(pid);
    fetchMatched(pid);
    fetchDuplicates(pid);
  }, [fetchStats, fetchAll, fetchUnmatched, fetchOrphans, fetchMatched, fetchDuplicates]);

  const refreshAfterMatch = useCallback((pid: string) => {
    fetchStats(pid);
    fetchUnmatched(pid);
    fetchMatched(pid);
    fetchOrphans(pid);
    fetchAll(pid);
  }, [fetchStats, fetchUnmatched, fetchMatched, fetchOrphans, fetchAll]);

  const refreshAfterFlag = useCallback((pid: string) => {
    fetchStats(pid);
    fetchAll(pid);
  }, [fetchStats, fetchAll]);

  const refreshAfterDuplicate = useCallback((pid: string) => {
    fetchStats(pid);
    fetchDuplicates(pid);
    fetchUnmatched(pid);
    fetchAll(pid);
  }, [fetchStats, fetchDuplicates, fetchUnmatched, fetchAll]);

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
        total: result.matched + result.noMatch,
        autoMatched: result.matched,
        noMatch: result.noMatch,
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
    refreshAfterMatch(periodId);
  };

  /* ── Mark as no match ───────────────────────────────────────── */
  const markNoMatch = async (receiptId: string) => {
    await supabase
      .from("receipts")
      .update({ match_status: "unmatched", match_suggestions: null, match_confidence: null })
      .eq("id", receiptId);
    toast.success("Moved to unmatched");
    refreshAfterMatch(periodId);
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
    refreshAfterMatch(periodId);
  };

  /* ── Flag tx as no receipt needed ───────────────────────────── */
  const flagNoReceipt = async (txId: string) => {
    await supabase
      .from("transactions")
      .update({ match_status: "no_receipt", notes: "Flagged as no receipt needed" })
      .eq("id", txId);
    toast.success("Flagged");
    refreshAfterMatch(periodId);
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
    refreshAfterDuplicate(periodId);
  };

  const dismissDuplicate = async (duplicateId: string, originalId: string) => {
    await supabase
      .from("receipts")
      .update({ duplicate_status: "not_duplicate" } as any)
      .in("id", [duplicateId, originalId]);
    toast.success("Dismissed — kept both");
    refreshAfterDuplicate(periodId);
  };

  /* ── Placeholder handler ────────────────────────────────────── */
  const confirmPlaceholder = async () => {
    if (!placeholderTx || !periodId) return;
    if (!placeholderTx.user_id) {
      toast.error("This transaction has no employee assigned");
      return;
    }

    setPlaceholderLoading(true);
    try {
      const blob = await buildPlaceholderBlob({
        id: placeholderTx.id,
        vendor_raw: placeholderTx.vendor_raw,
        vendor_normalized: placeholderTx.vendor_normalized,
        amount: placeholderTx.amount,
        transaction_date: placeholderTx.transaction_date,
        card_last_four: placeholderTx.card_last_four,
        employeeName: placeholderTx.user?.full_name ?? null,
        periodName: selectedPeriod?.name ?? null,
      });

      const storagePath = `receipts/${placeholderTx.user_id}/placeholders/${placeholderTx.id}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(storagePath, blob, { contentType: "application/pdf", upsert: true });
      if (uploadError) throw uploadError;

      const { data: newReceipt, error: receiptError } = await supabase
        .from("receipts")
        .insert({
          user_id: placeholderTx.user_id,
          statement_period_id: periodId,
          storage_path: storagePath,
          match_status: "matched",
          match_confidence: 1,
          transaction_id: placeholderTx.id,
          vendor_confirmed: placeholderTx.vendor_normalized ?? placeholderTx.vendor_raw,
          amount_confirmed: placeholderTx.amount,
          date_confirmed: placeholderTx.transaction_date,
          status: "approved",
          is_placeholder: true,
        } as any)
        .select("id")
        .single();
      if (receiptError) throw receiptError;

      await supabase
        .from("transactions")
        .update({ receipt_id: newReceipt.id, match_status: "matched", match_confidence: 1 })
        .eq("id", placeholderTx.id);

      toast.success("Placeholder filed — transaction moved to Matched");
      setPlaceholderTx(null);
      refreshAfterMatch(periodId);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create placeholder");
    } finally {
      setPlaceholderLoading(false);
    }
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
    refreshAfterFlag(periodId);
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
    refreshAfterFlag(periodId);
  };

  /* ── Bulk approve selected ──────────────────────────────────── */
  const handleBulkApprove = async (ids: Set<string>, clearSelection: () => void) => {
    if (ids.size === 0) return;
    const { error } = await supabase
      .from("receipts")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .in("id", Array.from(ids));
    if (error) {
      toast.error("Failed to approve selected");
      return;
    }
    toast.success(`${ids.size} receipt${ids.size === 1 ? "" : "s"} approved`);
    clearSelection();
    refreshAfterFlag(periodId);
  };

  /* ── Bulk flag selected ─────────────────────────────────────── */
  const handleBulkFlag = async (ids: Set<string>, clearSelection: () => void) => {
    if (ids.size === 0) return;
    const { error } = await supabase
      .from("receipts")
      .update({ status: "flagged", flag_reason: "Bulk flagged", reviewed_at: new Date().toISOString() })
      .in("id", Array.from(ids));
    if (error) {
      toast.error("Failed to flag selected");
      return;
    }
    toast.success(`${ids.size} receipt${ids.size === 1 ? "" : "s"} flagged`);
    clearSelection();
    refreshAfterFlag(periodId);
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
    refreshAfterFlag(periodId);
  };

  /* ── Open message dialog helper ─────────────────────────────── */
  const openMessageDialog = (target: MessageTarget) => {
    const firstName = target.employeeName?.split(" ")[0] ?? "there";
    const vendor = target.vendor || "a";
    const amount = target.amount != null ? `$${Number(target.amount).toFixed(2)}` : "an unknown amount";
    const date = target.date ?? "an unknown date";
    setMessageText(
      `Hi ${firstName}, we're missing a receipt for your ${vendor} charge of ${amount} on ${date}. Could you please upload it as soon as possible?`
    );
    setMessageTx(target);
  };

  const handleSendMessage = async () => {
    if (!messageTx || !user || !messageTx.user_id) return;
    setSendingMessage(true);
    const { error } = await (supabase as any)
      .from("receipt_messages")
      .insert({
        sender_id: user.id,
        recipient_id: messageTx.user_id,
        transaction_id: messageTx.transaction_id ?? null,
        receipt_id: messageTx.receipt_id ?? null,
        message: messageText,
      });
    setSendingMessage(false);
    if (error) {
      toast.error("Failed to send message");
      return;
    }
    toast.success(`Message sent to ${messageTx.employeeName ?? "employee"}`);
    setMessageTx(null);
    setMessageText("");
  };


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
    const receipt = [...unmatchedReceipts, ...allReceipts].find(r => r.id === receiptId);
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
      const sourceReceipt = [...unmatchedReceipts, ...allReceipts].find(
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
    refreshAfterMatch(periodId);
  };

  /* ── Helpers ────────────────────────────────────────────────── */
  const rv = (r: ReceiptRow) => r.vendor_confirmed ?? r.vendor_extracted ?? "—";
  const ra = (r: ReceiptRow) => r.amount_confirmed ?? r.amount_extracted;
  const rd = (r: ReceiptRow) => r.date_confirmed ?? r.date_extracted;
  const fmt = (n: number | null) => (n != null ? `$${Number(n).toFixed(2)}` : "—");

  const statCards = [
    { label: "Total Receipts", value: stats.total, icon: <Files className="h-5 w-5" />, color: "text-foreground", tab: "all" },
    { label: "Matched", value: stats.matched, icon: <FileCheck className="h-5 w-5" />, color: "text-accent", tab: "matched" },
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

  // Filter for duplicate groups by employee
  const matchesEmpDupe = (group: DuplicateGroup) => {
    if (!activeEmp) return true;
    const origName = group.original.employee?.full_name?.toLowerCase() ?? "";
    const dupeName = group.duplicate.employee?.full_name?.toLowerCase() ?? "";
    return origName.includes(activeEmp) || dupeName.includes(activeEmp);
  };

  const filteredAll = allReceipts.filter((r) => matchesVendorR(r) && matchesEmpR(r));
  const filteredUnmatched = unmatchedReceipts.filter((r) => matchesVendorR(r) && matchesEmpR(r));
  const filteredOrphans = orphanTxs.filter((tx) => matchesVendorTx(tx) && matchesEmpTx(tx));
  const filteredMatched = matchedReceipts.filter((r) => matchesVendorR(r) && matchesEmpR(r));
  const filteredDuplicates = duplicateGroups.filter((g) => matchesEmpDupe(g));

  // Paginated slices
  const pagedAll = filteredAll.slice(pageAll * PAGE_SIZE, (pageAll + 1) * PAGE_SIZE);
  const pagedUnmatched = filteredUnmatched.slice(pageUnmatched * PAGE_SIZE, (pageUnmatched + 1) * PAGE_SIZE);
  const pagedMatched = filteredMatched.slice(pageMatched * PAGE_SIZE, (pageMatched + 1) * PAGE_SIZE);
  const pagedOrphans = filteredOrphans.slice(pageOrphans * PAGE_SIZE, (pageOrphans + 1) * PAGE_SIZE);

  // Reset page on filter change
  useEffect(() => { setPageAll(0); setPageUnmatched(0); setPageMatched(0); setPageOrphans(0); }, [filterVendor, filterEmployee]);

  // Toggle helpers for bulk selection
  const toggleSelect = (id: string, set: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const toggleSelectAll = (items: ReceiptRow[], set: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const allSelected = items.every((r) => set.has(r.id));
    if (allSelected) {
      setter(new Set());
    } else {
      setter(new Set(items.map((r) => r.id)));
    }
  };

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
            <span className="text-muted-foreground">No Match: {bulkResult.noMatch}</span>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
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
              setSelectedUnmatched(new Set());
              setSelectedMatched(new Set());
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

        {/* Employee dropdown — now includes duplicates tab */}
        {(activeTab === "all" || activeTab === "unmatched" || activeTab === "matched" || activeTab === "no-receipt" || activeTab === "duplicates") && (
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

        {/* Spacer + Approve All */}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            disabled={approvingAll || selectedPeriod?.is_closed}
            onClick={handleApproveAll}
          >
            {approvingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
            Approve All Matched
          </Button>
        </div>
      </div>

      {/* Bulk selection action bar */}
      {activeTab === "unmatched" && selectedUnmatched.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{selectedUnmatched.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleBulkApprove(selectedUnmatched, () => setSelectedUnmatched(new Set()))}>
            <CheckCircle className="h-3 w-3" /> Approve Selected
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive" onClick={() => handleBulkFlag(selectedUnmatched, () => setSelectedUnmatched(new Set()))}>
            <Flag className="h-3 w-3" /> Flag Selected
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedUnmatched(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {activeTab === "matched" && selectedMatched.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{selectedMatched.size} selected</span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleBulkApprove(selectedMatched, () => setSelectedMatched(new Set()))}>
            <CheckCircle className="h-3 w-3" /> Approve Selected
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive" onClick={() => handleBulkFlag(selectedMatched, () => setSelectedMatched(new Set()))}>
            <Flag className="h-3 w-3" /> Flag Selected
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedMatched(new Set())}>
            Clear
          </Button>
        </div>
      )}

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
            <div className="space-y-1">
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
                    {pagedAll.map((r) => (
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
                                : "bg-destructive/15 text-destructive"
                            }`}
                          >
                            {r.match_status === "auto_matched" ? "Auto" : r.match_status === "manual_match" ? "Manual" : r.match_status === "matched" ? "Matched" : "Unmatched"}
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
              <TablePagination page={pageAll} totalItems={filteredAll.length} onPageChange={setPageAll} />
            </div>
          )}
        </TabsContent>

        {/* ── Tab: No Match Found ──────────────────────────────── */}
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
                      <TableHead className="w-10">
                        <Checkbox
                          checked={pagedUnmatched.length > 0 && pagedUnmatched.every((r) => selectedUnmatched.has(r.id))}
                          onCheckedChange={() => toggleSelectAll(pagedUnmatched, selectedUnmatched, setSelectedUnmatched)}
                        />
                      </TableHead>
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
                    {pagedUnmatched.map((r) => {
                      const missingExtraction = !r.vendor_extracted && !r.vendor_confirmed;
                      return (
                        <TableRow key={r.id} className={missingExtraction ? "border-l-2 border-l-warning" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selectedUnmatched.has(r.id)}
                              onCheckedChange={() => toggleSelect(r.id, selectedUnmatched, setSelectedUnmatched)}
                            />
                          </TableCell>
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
              <TablePagination page={pageUnmatched} totalItems={filteredUnmatched.length} onPageChange={setPageUnmatched} />
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Tx Missing Receipt ──────────────────────────── */}
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
            <div className="space-y-1">
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
                    {pagedOrphans.map((tx) => (
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
                              <Button size="sm" variant="ghost" className="text-xs h-7 text-muted-foreground" onClick={() => setPlaceholderTx(tx)}>
                                <FileDown className="h-3 w-3 mr-1" /> Placeholder
                              </Button>
                              {tx.user_id && (
                                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => openMessageDialog({
                                  id: tx.id,
                                  user_id: tx.user_id,
                                  vendor: tx.vendor_normalized ?? tx.vendor_raw ?? "unknown",
                                  amount: tx.amount,
                                  date: tx.transaction_date,
                                  employeeName: tx.user?.full_name ?? null,
                                  transaction_id: tx.id,
                                })}>
                                  <MessageSquare className="h-3 w-3 mr-1" /> Message
                                </Button>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination page={pageOrphans} totalItems={filteredOrphans.length} onPageChange={setPageOrphans} />
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Matched ─────────────────────────────────────── */}
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
            <div className="space-y-1">
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={pagedMatched.length > 0 && pagedMatched.every((r) => selectedMatched.has(r.id))}
                          onCheckedChange={() => toggleSelectAll(pagedMatched, selectedMatched, setSelectedMatched)}
                        />
                      </TableHead>
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
                    {pagedMatched.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedMatched.has(r.id)}
                            onCheckedChange={() => toggleSelect(r.id, selectedMatched, setSelectedMatched)}
                          />
                        </TableCell>
                        <TableCell>
                          <ReceiptThumb
                            storagePath={r.storage_path}
                            onClick={(url) => (r.is_placeholder ? window.open(url, "_blank") : setLightboxUrl(url))}
                            isPlaceholder={r.is_placeholder ?? false}
                          />
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
                              {r.user_id && (
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openMessageDialog({
                                  id: r.id,
                                  user_id: r.user_id,
                                  vendor: rv(r),
                                  amount: ra(r),
                                  date: rd(r),
                                  employeeName: r.employee?.full_name ?? null,
                                  transaction_id: r.transaction?.id,
                                  receipt_id: r.id,
                                })}>
                                  <MessageSquare className="h-3 w-3" />
                                </Button>
                              )}
                              <ReceiptActionsMenu receiptId={r.id} status={r.status} />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <TablePagination page={pageMatched} totalItems={filteredMatched.length} onPageChange={setPageMatched} />
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Duplicates ──────────────────────────────────── */}
        <TabsContent value="duplicates">
          {duplicatesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-lg" />
              ))}
            </div>
          ) : filteredDuplicates.length === 0 ? (
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

              {filteredDuplicates.map((group, idx) => (
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

      {/* ── Placeholder Confirmation Dialog ─────────────────── */}
      <AlertDialog open={!!placeholderTx} onOpenChange={(open) => !open && setPlaceholderTx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No receipt available?</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a placeholder document for{" "}
              <span className="font-medium">{placeholderTx?.vendor_normalized ?? placeholderTx?.vendor_raw ?? "this transaction"}</span>{" "}
              ({placeholderTx?.amount != null ? `$${Number(placeholderTx.amount).toFixed(2)}` : ""}
              {placeholderTx?.transaction_date ? ` · ${placeholderTx.transaction_date}` : ""}).
              The placeholder will be filed in place of a receipt and the transaction
              will move to Matched. This confirms no physical receipt exists.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPlaceholder} disabled={placeholderLoading}>
              {placeholderLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Yes, generate placeholder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* ── Message Employee Dialog ────────────────────────────── */}
      <Dialog open={!!messageTx} onOpenChange={(open) => { if (!open) { setMessageTx(null); setMessageText(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Message to {messageTx?.employeeName ?? "Employee"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            re: {messageTx?.vendor ?? "—"} · {messageTx?.amount != null ? `$${Number(messageTx.amount).toFixed(2)}` : "—"} · {messageTx?.date ?? "—"}
          </p>
          <Textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMessageTx(null); setMessageText(""); }}>
              Cancel
            </Button>
            <Button onClick={handleSendMessage} disabled={sendingMessage || !messageText.trim() || !messageTx?.user_id}>
              {sendingMessage ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <MessageSquare className="h-4 w-4 mr-1" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Matching;
