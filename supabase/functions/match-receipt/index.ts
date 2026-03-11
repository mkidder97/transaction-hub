import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/* ── Vendor normalisation ────────────────────────────────────────── */
function normalizeVendor(v: string | null): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(llc|inc|co|corp|ltd|limited|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function vendorScore(a: string | null, b: string | null): number {
  const na = normalizeVendor(a);
  const nb = normalizeVendor(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  return 0;
}

/* ── Scoring helpers ─────────────────────────────────────────────── */
function amountScore(rAmount: number, tAmount: number | null): number {
  if (tAmount == null) return 0;
  const diff = Math.abs(rAmount - tAmount);
  if (diff < 0.01) return 1.0;
  const pct = diff / Math.max(Math.abs(rAmount), 0.01);
  if (pct <= 0.01) return 0.9;
  if (pct <= 0.05) return 0.6;
  return 0;
}

function dateScore(rDate: string | null, tDate: string | null): number {
  if (!rDate || !tDate) return 0;
  const rd = new Date(rDate);
  const td = new Date(tDate);
  const days = Math.abs((rd.getTime() - td.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0.5) return 1.0;
  if (days <= 1) return 0.8;
  if (days <= 3) return 0.5;
  return 0;
}

function computeScore(
  rAmount: number,
  rDate: string | null,
  rVendor: string | null,
  tx: { amount: number | null; transaction_date: string | null; vendor_raw: string | null; vendor_normalized: string | null },
): number {
  const a = amountScore(rAmount, tx.amount);
  const d = dateScore(rDate, tx.transaction_date);
  const v = vendorScore(rVendor, tx.vendor_normalized ?? tx.vendor_raw);
  return a * 0.4 + d * 0.35 + v * 0.25;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Validate JWT from caller
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user }, error: authErr } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { receiptId, statementPeriod } = body;

    // ── Bulk mode: match all unmatched receipts for a period ───────
    if (statementPeriod && !receiptId) {
      const { data: receipts } = await sb
        .from("receipts")
        .select("id")
        .eq("statement_period_id", statementPeriod)
        .eq("match_status", "unmatched")
        .not("vendor_extracted", "is", null);

      if (!receipts || receipts.length === 0) {
        return new Response(
          JSON.stringify({ total: 0, autoMatched: 0, needsReview: 0, noMatch: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      let autoMatched = 0;
      let needsReview = 0;
      let noMatch = 0;

      for (const r of receipts) {
        // Small delay to avoid overwhelming the DB
        await new Promise((resolve) => setTimeout(resolve, 100));

        const result = await matchSingleReceipt(sb, r.id);
        if (result.status === "auto_matched") autoMatched++;
        else if (result.status === "needs_review") needsReview++;
        else noMatch++;
      }

      return new Response(
        JSON.stringify({ total: receipts.length, autoMatched, needsReview, noMatch }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Single receipt mode ───────────────────────────────────────
    if (!receiptId) {
      return new Response(JSON.stringify({ error: "receiptId or statementPeriod required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await matchSingleReceipt(sb, receiptId);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-receipt error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/* ── Core matching for one receipt ───────────────────────────────── */
async function matchSingleReceipt(
  sb: ReturnType<typeof createClient>,
  receiptId: string,
) {
  // Fetch receipt
  const { data: receipt, error: rErr } = await sb
    .from("receipts")
    .select("id, user_id, statement_period_id, amount_confirmed, amount_extracted, date_confirmed, date_extracted, vendor_confirmed, vendor_extracted")
    .eq("id", receiptId)
    .single();

  if (rErr || !receipt) {
    return { receiptId, status: "error", error: "Receipt not found" };
  }

  const rAmount = (receipt.amount_confirmed ?? receipt.amount_extracted) as number | null;
  const rDate = (receipt.date_confirmed ?? receipt.date_extracted) as string | null;
  const rVendor = (receipt.vendor_confirmed ?? receipt.vendor_extracted) as string | null;

  if (rAmount == null) {
    return { receiptId, status: "no_match", score: 0 };
  }

  // Fetch threshold from app_settings
  let threshold = 0.85;
  const { data: setting } = await sb
    .from("app_settings")
    .select("value")
    .eq("key", "auto_match_threshold")
    .single();
  if (setting?.value) {
    const parsed = parseFloat(setting.value);
    if (!isNaN(parsed)) threshold = parsed;
  }

  // Fetch unmatched transactions — try user-scoped first, fall back to all
  let transactions: any[] = [];

  if (receipt.user_id && receipt.statement_period_id) {
    const { data } = await sb
      .from("transactions")
      .select("id, amount, transaction_date, vendor_raw, vendor_normalized")
      .eq("statement_period_id", receipt.statement_period_id)
      .eq("user_id", receipt.user_id)
      .eq("match_status", "unmatched");
    transactions = data ?? [];
  }

  // Fall back to all unmatched in period if no user-scoped matches
  if (transactions.length === 0 && receipt.statement_period_id) {
    const { data } = await sb
      .from("transactions")
      .select("id, amount, transaction_date, vendor_raw, vendor_normalized")
      .eq("statement_period_id", receipt.statement_period_id)
      .eq("match_status", "unmatched");
    transactions = data ?? [];
  }

  if (transactions.length === 0) {
    return { receiptId, status: "no_match", score: 0 };
  }

  // Score all candidates
  const scored = transactions.map((tx: any) => ({
    transactionId: tx.id,
    vendor: tx.vendor_normalized ?? tx.vendor_raw,
    amount: tx.amount,
    date: tx.transaction_date,
    score: computeScore(rAmount, rDate, rVendor, tx),
  }));

  scored.sort((a: any, b: any) => b.score - a.score);
  const best = scored[0];

  if (best.score >= threshold) {
    // Auto-match
    await sb
      .from("receipts")
      .update({
        transaction_id: best.transactionId,
        match_status: "auto_matched",
        match_confidence: best.score,
        match_suggestions: null,
      })
      .eq("id", receiptId);

    await sb
      .from("transactions")
      .update({
        receipt_id: receiptId,
        match_status: "matched",
        match_confidence: best.score,
      })
      .eq("id", best.transactionId);

    return { receiptId, status: "auto_matched", transactionId: best.transactionId, score: best.score };
  }

  if (best.score >= 0.6) {
    // Needs review — store top 3 candidates
    const top3 = scored.slice(0, 3).map((s: any) => ({
      transactionId: s.transactionId,
      vendor: s.vendor,
      amount: s.amount,
      date: s.date,
      score: Math.round(s.score * 100) / 100,
    }));

    await sb
      .from("receipts")
      .update({
        match_suggestions: top3,
        match_status: "needs_review",
        match_confidence: best.score,
      })
      .eq("id", receiptId);

    return { receiptId, status: "needs_review", suggestions: top3, score: best.score };
  }

  // No match
  return { receiptId, status: "no_match", score: best.score };
}
