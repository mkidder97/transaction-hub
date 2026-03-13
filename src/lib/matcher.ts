import { supabase } from "@/integrations/supabase/client";

export interface MatchCandidate {
  transactionId: string;
  vendor: string | null;
  amount: number | null;
  date: string | null;
  score: number;
}

export interface MatchResult {
  transactionId: string | null;
  score: number;
  status: "matched" | "no_match";
  suggestions: MatchCandidate[];
}

/* ── Fuzzy vendor similarity (Dice coefficient on bigrams) ────────── */

function bigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, "");
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function vendorSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const bg1 = bigrams(a);
  const bg2 = bigrams(b);
  if (bg1.size === 0 || bg2.size === 0) return 0;
  let overlap = 0;
  for (const bi of bg1) {
    if (bg2.has(bi)) overlap++;
  }
  return (2 * overlap) / (bg1.size + bg2.size);
}

/* ── Match a single receipt to transactions ───────────────────────── */

export async function matchReceiptToTransactions(
  receiptId: string,
): Promise<MatchResult> {
  const { data: receipt, error: rErr } = await supabase
    .from("receipts")
    .select(
      "id, user_id, statement_period_id, amount_confirmed, amount_extracted, date_confirmed, date_extracted, vendor_confirmed, vendor_extracted",
    )
    .eq("id", receiptId)
    .single();

  if (rErr || !receipt)
    return { transactionId: null, score: 0, status: "no_match", suggestions: [] };

  const rAmount =
    (receipt.amount_confirmed as number | null) ??
    (receipt.amount_extracted as number | null);
  const rDateStr =
    (receipt.date_confirmed as string | null) ??
    (receipt.date_extracted as string | null);
  const rDate = rDateStr ? new Date(rDateStr) : null;
  const rVendor =
    (receipt.vendor_confirmed as string | null) ??
    (receipt.vendor_extracted as string | null);

  if (rAmount == null && !rVendor && !rDate) {
    return { transactionId: null, score: 0, status: "no_match", suggestions: [] };
  }

  const periodId = receipt.statement_period_id as string | null;

  let query = supabase
    .from("transactions")
    .select("id, amount, transaction_date, vendor_raw, vendor_normalized, user_id")
    .eq("match_status", "unmatched");

  if (periodId) {
    query = query.eq("statement_period_id", periodId);
  }

  const { data: transactions } = await query.or(`user_id.eq.${receipt.user_id},user_id.is.null`);

  if (!transactions || transactions.length === 0)
    return { transactionId: null, score: 0, status: "no_match", suggestions: [] };

  const scored: MatchCandidate[] = [];

  for (const tx of transactions) {
    let score = 0;
    const txAmount = tx.amount as number | null;
    const txDateStr = tx.transaction_date as string | null;

    // Amount scoring (max 0.5)
    if (rAmount != null && txAmount != null) {
      const diff = Math.abs(txAmount - rAmount);
      if (diff <= 0.01) {
        score += 0.5;
      } else if (diff / Math.max(Math.abs(rAmount), 0.01) <= 0.02) {
        score += 0.3;
      }
    }

    // Date scoring (max 0.3)
    if (rDate && txDateStr) {
      const txDate = new Date(txDateStr);
      const daysDiff = Math.abs(
        (rDate.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysDiff < 1) {
        score += 0.3;
      } else if (daysDiff <= 3) {
        score += 0.15;
      } else {
        continue;
      }
    }

    // Vendor similarity scoring (max 0.2)
    const txVendor = (tx.vendor_normalized as string | null) ?? (tx.vendor_raw as string | null);
    const sim = vendorSimilarity(rVendor, txVendor);
    score += sim * 0.2;

    scored.push({
      transactionId: tx.id,
      vendor: txVendor,
      amount: txAmount,
      date: txDateStr,
      score,
    });
  }

  if (scored.length === 0) {
    return { transactionId: null, score: 0, status: "no_match", suggestions: [] };
  }

  scored.sort((a, b) => b.score - a.score);
  const top3 = scored.slice(0, 3).map((s) => ({
    ...s,
    score: Math.round(s.score * 100) / 100,
  }));

  const best = scored[0];

  // Recompute date score for best candidate
  const bestTx = transactions.find(tx => tx.id === best.transactionId);
  const bestDateStr = bestTx?.transaction_date as string | null;
  let bestDateScore = 0;
  if (rDate && bestDateStr) {
    const daysDiff = Math.abs((rDate.getTime() - new Date(bestDateStr).getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 1) bestDateScore = 0.3;
    else if (daysDiff <= 3) bestDateScore = 0.15;
  }

  if (best.score >= 0.7 && bestDateScore > 0)
    return { transactionId: best.transactionId, score: best.score, status: "matched", suggestions: top3 };

  // Everything below threshold → no_match (but still return suggestions for manual search)
  return { transactionId: null, score: best.score, status: "no_match", suggestions: top3 };
}

/* ── Run matching for an entire period ────────────────────────────── */

export interface PeriodMatchSummary {
  matched: number;
  noMatch: number;
}

export async function runMatchingForPeriod(
  periodId: string,
): Promise<PeriodMatchSummary> {
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id")
    .eq("statement_period_id", periodId)
    .eq("match_status", "unmatched");

  if (!receipts || receipts.length === 0)
    return { matched: 0, noMatch: 0 };

  let matched = 0;
  let noMatch = 0;

  for (const r of receipts) {
    const result = await matchReceiptToTransactions(r.id);

    if (result.status === "matched" && result.transactionId) {
      await supabase
        .from("receipts")
        .update({
          match_status: "matched",
          transaction_id: result.transactionId,
          match_confidence: result.score,
          match_suggestions: null,
        })
        .eq("id", r.id);

      await supabase
        .from("transactions")
        .update({
          match_status: "matched",
          receipt_id: r.id,
          match_confidence: result.score,
        })
        .eq("id", result.transactionId);

      matched++;
    } else {
      // Store suggestions for manual "Find Transaction" but keep as unmatched
      await supabase
        .from("receipts")
        .update({
          match_status: "unmatched",
          transaction_id: null,
          match_confidence: null,
          match_suggestions: result.suggestions.length > 0 ? (result.suggestions as unknown as any) : null,
        })
        .eq("id", r.id);

      noMatch++;
    }
  }

  return { matched, noMatch };
}
