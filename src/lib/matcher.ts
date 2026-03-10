import { supabase } from "@/integrations/supabase/client";

export interface MatchResult {
  transactionId: string | null;
  score: number;
  status: "matched" | "needs_review" | "no_match";
}

export async function matchReceiptToTransactions(
  receiptId: string,
): Promise<MatchResult> {
  // 1. Fetch receipt
  const { data: receipt, error: rErr } = await supabase
    .from("receipts")
    .select(
      "id, user_id, amount_confirmed, amount_extracted, date_confirmed, date_extracted",
    )
    .eq("id", receiptId)
    .single();

  if (rErr || !receipt)
    return { transactionId: null, score: 0, status: "no_match" };

  const rAmount =
    (receipt.amount_confirmed as number | null) ??
    (receipt.amount_extracted as number | null);
  const rDateStr =
    (receipt.date_confirmed as string | null) ??
    (receipt.date_extracted as string | null);
  const rDate = rDateStr ? new Date(rDateStr) : null;

  if (rAmount == null)
    return { transactionId: null, score: 0, status: "no_match" };

  // 2. Fetch unmatched transactions for the same user
  const { data: transactions } = await supabase
    .from("transactions")
    .select("id, amount, transaction_date")
    .eq("user_id", receipt.user_id)
    .eq("match_status", "unmatched");

  if (!transactions || transactions.length === 0)
    return { transactionId: null, score: 0, status: "no_match" };

  // 3. Score each transaction
  let bestId: string | null = null;
  let bestScore = 0;

  for (const tx of transactions) {
    let score = 0;
    const txAmount = tx.amount as number | null;
    const txDateStr = tx.transaction_date as string | null;

    // Amount scoring
    if (txAmount != null) {
      const diff = Math.abs(txAmount - rAmount);
      if (diff <= 0.01) {
        score += 0.5;
      } else if (diff / Math.max(Math.abs(rAmount), 0.01) <= 0.02) {
        score += 0.3;
      }
    }

    // Date scoring
    if (rDate && txDateStr) {
      const txDate = new Date(txDateStr);
      const daysDiff = Math.abs(
        (rDate.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysDiff < 1) {
        score += 0.3;
      } else if (daysDiff <= 3) {
        score += 0.15;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = tx.id;
    }
  }

  // 4. Classify
  if (bestScore >= 0.7)
    return { transactionId: bestId, score: bestScore, status: "matched" };
  if (bestScore >= 0.4)
    return { transactionId: bestId, score: bestScore, status: "needs_review" };
  return { transactionId: null, score: bestScore, status: "no_match" };
}

export interface PeriodMatchSummary {
  matched: number;
  needs_review: number;
  skipped: number;
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
    return { matched: 0, needs_review: 0, skipped: 0 };

  let matched = 0;
  let needs_review = 0;
  let skipped = 0;

  for (const r of receipts) {
    const result = await matchReceiptToTransactions(r.id);

    if (result.status === "matched" && result.transactionId) {
      await supabase
        .from("receipts")
        .update({
          match_status: "matched",
          transaction_id: result.transactionId,
          match_confidence: result.score,
        })
        .eq("id", r.id);

      await supabase
        .from("transactions")
        .update({
          match_status: "matched",
          match_confidence: result.score,
        })
        .eq("id", result.transactionId);

      matched++;
    } else if (result.status === "needs_review" && result.transactionId) {
      await supabase
        .from("receipts")
        .update({
          match_status: "manual_match",
          transaction_id: result.transactionId,
          match_confidence: result.score,
        })
        .eq("id", r.id);

      needs_review++;
    } else {
      skipped++;
    }
  }

  return { matched, needs_review, skipped };
}
