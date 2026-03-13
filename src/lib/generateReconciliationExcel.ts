import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export async function generateReconciliationExcel(periodId: string, userId?: string): Promise<void> {
  // Fetch period info
  const { data: period } = await supabase
    .from("statement_periods")
    .select("name, start_date, end_date")
    .eq("id", periodId)
    .single();

  if (!period) throw new Error("Period not found");

  // Fetch employee name for filename if filtered
  let employeeName = "";
  if (userId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();
    employeeName = profile?.full_name?.replace(/\s+/g, "-") ?? "employee";
  }

  // Query 1 — receipts with joins
  let receiptsQuery = supabase
    .from("receipts")
    .select(
      "id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, flag_reason, category_id, user_id, transaction_id, employee:profiles!receipts_user_id_fkey(full_name), category:expense_categories(name), transaction:transactions!receipts_transaction_id_fkey(vendor_normalized, vendor_raw, amount, transaction_date)"
    )
    .eq("statement_period_id", periodId);
  if (userId) receiptsQuery = receiptsQuery.eq("user_id", userId);

  // Query 2 — transactions with user join
  let txQuery = supabase
    .from("transactions")
    .select(
      "id, vendor_raw, vendor_normalized, amount, transaction_date, card_last_four, match_status, user:profiles!transactions_user_id_fkey(full_name)"
    )
    .eq("statement_period_id", periodId);
  if (userId) txQuery = txQuery.eq("user_id", userId);

  const [{ data: receipts }, { data: allTransactions }] = await Promise.all([receiptsQuery, txQuery]);

  const r = receipts ?? [];
  const txs = allTransactions ?? [];

  const matched = r.filter((x) => ["auto_matched", "manual_match", "matched"].includes(x.match_status));
  const unmatched = r.filter((x) => x.match_status === "unmatched");
  const unmatchedTxs = txs.filter((x) => x.match_status === "unmatched");
  const flagged = r.filter((x) => x.status === "flagged");

  // Helpers
  const vendor = (row: any) => row.vendor_confirmed ?? row.vendor_extracted ?? "";
  const amt = (n: any): number | null => (n != null ? Number(n) : null);
  const date = (row: any): string => row.date_confirmed ?? row.date_extracted ?? "";

  // Category breakdown
  const catMap: Record<string, { name: string; count: number; total: number }> = {};
  for (const receipt of r) {
    const catName = (receipt.category as any)?.name ?? "Uncategorized";
    if (!catMap[catName]) catMap[catName] = { name: catName, count: 0, total: 0 };
    catMap[catName].count++;
    catMap[catName].total += Number(receipt.amount_confirmed ?? receipt.amount_extracted ?? 0);
  }
  const categories = Object.values(catMap).sort((a, b) => b.total - a.total);

  const wb = XLSX.utils.book_new();

  // Sheet 1 — Matched Pairs
  const matchedData = matched.map((row) => ({
    Employee: (row.employee as any)?.full_name ?? "",
    "Receipt Vendor": vendor(row),
    "Receipt Amount": amt(row.amount_confirmed ?? row.amount_extracted),
    "Receipt Date": date(row),
    "Tx Vendor": (row.transaction as any)?.vendor_normalized ?? (row.transaction as any)?.vendor_raw ?? "",
    "Tx Amount": amt((row.transaction as any)?.amount),
    "Tx Date": (row.transaction as any)?.transaction_date ?? "",
    "Match Type": row.match_status === "auto_matched" ? "Auto" : "Manual",
    "Confidence %": row.match_confidence != null ? Math.round(Number(row.match_confidence) * 100) : null,
  }));
  const ws1 = XLSX.utils.json_to_sheet(matchedData);
  ws1["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Matched Pairs");

  // Sheet 2 — Unmatched Receipts
  const unmatchedData = unmatched.map((row) => ({
    Employee: (row.employee as any)?.full_name ?? "",
    Vendor: vendor(row),
    Amount: amt(row.amount_confirmed ?? row.amount_extracted),
    Date: date(row),
    Category: (row.category as any)?.name ?? "",
    Status: row.status,
  }));
  const ws2 = XLSX.utils.json_to_sheet(unmatchedData);
  ws2["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Unmatched Receipts");

  // Sheet 3 — Missing Receipts (transactions without receipt)
  const missingData = unmatchedTxs.map((tx: any) => ({
    Date: tx.transaction_date ?? "",
    Vendor: tx.vendor_normalized ?? tx.vendor_raw ?? "",
    Amount: amt(tx.amount),
    "Card Last Four": tx.card_last_four ? `•••• ${tx.card_last_four}` : "",
    Cardholder: tx.user?.full_name ?? "",
  }));
  const ws3 = XLSX.utils.json_to_sheet(missingData);
  ws3["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Missing Receipts");

  // Sheet 4 — Flagged
  const flaggedData = flagged.map((row) => ({
    Employee: (row.employee as any)?.full_name ?? "",
    Vendor: vendor(row),
    Amount: amt(row.amount_confirmed ?? row.amount_extracted),
    "Flag Reason": row.flag_reason ?? "",
  }));
  const ws4 = XLSX.utils.json_to_sheet(flaggedData);
  ws4["!cols"] = [{ wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Flagged");

  // Sheet 5 — Category Summary
  const catData = categories.map((c) => ({
    Category: c.name,
    "Receipt Count": c.count,
    "Total Amount": c.total,
  }));
  const ws5 = XLSX.utils.json_to_sheet(catData);
  ws5["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws5, "Category Summary");

  // Download
  const periodName = period.name.replace(/\s+/g, "-").toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const namePart = employeeName ? `-${employeeName.toLowerCase()}` : "";
  XLSX.writeFile(wb, `reconciliation-${periodName}${namePart}-${dateStr}.xlsx`);
}
