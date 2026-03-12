import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { supabase } from "@/integrations/supabase/client";

export async function generateReconciliationPdf(periodId: string): Promise<void> {
  // Fetch period info
  const { data: period } = await supabase
    .from("statement_periods")
    .select("name, start_date, end_date")
    .eq("id", periodId)
    .single();

  if (!period) throw new Error("Period not found");

  // Fetch all receipts with joins
  const { data: receipts } = await supabase
    .from("receipts")
    .select(
      "id, vendor_extracted, vendor_confirmed, amount_extracted, amount_confirmed, date_extracted, date_confirmed, status, match_status, match_confidence, flag_reason, category_id, user_id, transaction_id, employee:profiles!receipts_user_id_fkey(full_name), category:expense_categories(name), transaction:transactions!receipts_transaction_id_fkey(vendor_normalized, vendor_raw, amount, transaction_date)"
    )
    .eq("statement_period_id", periodId);

  // Fetch ALL transactions for this period (separate query — Section 3 needs unmatched transactions, NOT receipts)
  const { data: allTransactions } = await supabase
    .from("transactions")
    .select(
      "id, vendor_raw, vendor_normalized, amount, transaction_date, card_last_four, match_status, user:profiles!transactions_user_id_fkey(full_name)"
    )
    .eq("statement_period_id", periodId);

  const r = receipts ?? [];
  const txs = allTransactions ?? [];

  // Stats
  const totalReceipts = r.length;
  const matched = r.filter((x) => ["auto_matched", "manual_match", "matched"].includes(x.match_status));
  const unmatched = r.filter((x) => x.match_status === "unmatched");
  const unmatchedTxs = txs.filter((x) => x.match_status === "unmatched");
  const flagged = r.filter((x) => x.status === "flagged");
  const matchRate = totalReceipts > 0 ? Math.round((matched.length / totalReceipts) * 100) : 0;

  // Category breakdown
  const catMap: Record<string, { name: string; count: number; total: number }> = {};
  for (const receipt of r) {
    const catName = (receipt.category as any)?.name ?? "Uncategorized";
    if (!catMap[catName]) catMap[catName] = { name: catName, count: 0, total: 0 };
    catMap[catName].count++;
    catMap[catName].total += Number(receipt.amount_confirmed ?? receipt.amount_extracted ?? 0);
  }
  const categories = Object.values(catMap).sort((a, b) => b.total - a.total);

  // Build PDF
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // Cover page
  doc.setFontSize(22);
  doc.text("SRC Receipt Vault", pageW / 2, 50, { align: "center" });
  doc.setFontSize(16);
  doc.text("Reconciliation Report", pageW / 2, 62, { align: "center" });
  doc.setFontSize(12);
  doc.text(period.name, pageW / 2, 78, { align: "center" });
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageW / 2, 88, { align: "center" });

  // Summary stats
  const summaryY = 108;
  doc.setFontSize(11);
  const summaryLines = [
    `Total Receipts: ${totalReceipts}`,
    `Matched: ${matched.length}`,
    `Unmatched Receipts: ${unmatched.length}`,
    `Transactions Without Receipt: ${unmatchedTxs.length}`,
    `Flagged: ${flagged.length}`,
    `Match Rate: ${matchRate}%`,
  ];
  summaryLines.forEach((line, i) => {
    doc.text(line, pageW / 2, summaryY + i * 8, { align: "center" });
  });

  // Helper
  const vendor = (row: any) => row.vendor_confirmed ?? row.vendor_extracted ?? "—";
  const amt = (n: any) => (n != null ? `$${Number(n).toFixed(2)}` : "—");
  const date = (row: any) => row.date_confirmed ?? row.date_extracted ?? "—";

  // Section 1 — Matched Pairs
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Section 1: Matched Pairs", 14, 20);

  autoTable(doc, {
    startY: 28,
    head: [["Employee", "Receipt Vendor", "Receipt Amt", "Receipt Date", "Tx Vendor", "Tx Amt", "Tx Date", "Type", "Confidence"]],
    body: matched.map((row) => [
      (row.employee as any)?.full_name ?? "—",
      vendor(row),
      amt(row.amount_confirmed ?? row.amount_extracted),
      date(row),
      (row.transaction as any)?.vendor_normalized ?? (row.transaction as any)?.vendor_raw ?? "—",
      amt((row.transaction as any)?.amount),
      (row.transaction as any)?.transaction_date ?? "—",
      row.match_status === "auto_matched" ? "Auto" : "Manual",
      row.match_confidence != null ? `${Math.round(Number(row.match_confidence) * 100)}%` : "—",
    ]),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  // Section 2 — Unmatched Receipts
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Section 2: Unmatched Receipts", 14, 20);

  autoTable(doc, {
    startY: 28,
    head: [["Employee", "Vendor", "Amount", "Date", "Category", "Status"]],
    body: unmatched.map((row) => [
      (row.employee as any)?.full_name ?? "—",
      vendor(row),
      amt(row.amount_confirmed ?? row.amount_extracted),
      date(row),
      (row.category as any)?.name ?? "—",
      row.status,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [234, 179, 8] },
  });

  // Section 3 — Transactions Without Receipt (queries TRANSACTIONS table, not receipts)
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Section 3: Transactions Without Receipt", 14, 20);

  autoTable(doc, {
    startY: 28,
    head: [["Date", "Vendor", "Amount", "Card", "Cardholder"]],
    body: unmatchedTxs.map((tx) => [
      (tx as any).transaction_date ?? "—",
      (tx as any).vendor_normalized ?? (tx as any).vendor_raw ?? "—",
      amt((tx as any).amount),
      (tx as any).card_last_four ? `•••• ${(tx as any).card_last_four}` : "—",
      (tx as any).user?.full_name ?? "—",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [107, 114, 128] },
  });

  // Section 4 — Flagged Receipts
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Section 4: Flagged Receipts", 14, 20);

  autoTable(doc, {
    startY: 28,
    head: [["Employee", "Vendor", "Amount", "Flag Reason"]],
    body: flagged.map((row) => [
      (row.employee as any)?.full_name ?? "—",
      vendor(row),
      amt(row.amount_confirmed ?? row.amount_extracted),
      row.flag_reason ?? "—",
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [239, 68, 68] },
  });

  // Section 5 — Category Breakdown
  doc.addPage();
  doc.setFontSize(14);
  doc.text("Section 5: Category Breakdown", 14, 20);

  autoTable(doc, {
    startY: 28,
    head: [["Category", "Receipt Count", "Total Amount"]],
    body: categories.map((c) => [c.name, String(c.count), amt(c.total)]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [99, 102, 241] },
  });

  // Save
  const filename = `reconciliation-${period.name.replace(/\s+/g, "-").toLowerCase()}.pdf`;
  doc.save(filename);
}
