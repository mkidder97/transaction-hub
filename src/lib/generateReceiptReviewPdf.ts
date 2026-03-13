import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { getSignedReceiptUrl } from "@/lib/getSignedReceiptUrl";

export async function generateReceiptReviewPdf(
  periodId: string,
  receiptIds?: string[]
): Promise<void> {
  // 1. Fetch period name
  const { data: period } = await supabase
    .from("statement_periods")
    .select("name")
    .eq("id", periodId)
    .single();

  if (!period) throw new Error("Period not found");

  // 2. Fetch receipts
  let q = supabase
    .from("receipts")
    .select(
      "id, vendor_confirmed, vendor_extracted, amount_confirmed, amount_extracted, date_confirmed, date_extracted, status, match_status, storage_path, is_placeholder, created_at, employee:profiles!receipts_user_id_fkey(full_name), category:expense_categories(name), transaction:transactions!receipts_transaction_id_fkey(vendor_normalized, amount, transaction_date)"
    )
    .eq("statement_period_id", periodId)
    .order("created_at", { ascending: true });

  if (receiptIds && receiptIds.length > 0) {
    q = q.in("id", receiptIds);
  }

  const { data: receipts } = await q;
  const rows = (receipts as unknown as any[]) ?? [];
  if (rows.length === 0) throw new Error("No receipts found");

  // 3. Build PDF
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const headerH = 22;
  const footerH = 12;
  const imgAreaTop = headerH;
  const imgAreaH = pageH - headerH - footerH;
  const imgMaxW = 190;
  const imgMaxH = imgAreaH - 6; // 6mm padding
  const total = rows.length;

  const fmt = (n: any) => (n != null ? `$${Number(n).toFixed(2)}` : "—");

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (i > 0) doc.addPage();

    const vendor = r.vendor_confirmed ?? r.vendor_extracted ?? "—";
    const amount = r.amount_confirmed ?? r.amount_extracted;
    const date = r.date_confirmed ?? r.date_extracted ?? "—";
    const empName = r.employee?.full_name ?? "—";
    const catName = r.category?.name ?? "—";
    const matchLabel = (r.match_status ?? "").replace(/_/g, " ");

    // ── Header strip ──
    doc.setFillColor(243, 244, 246);
    doc.rect(0, 0, pageW, headerH, "F");

    // Left: employee + vendor
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text(empName, 10, 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(vendor, 10, 14);

    // Center: amount
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(17, 24, 39);
    doc.text(fmt(amount), pageW / 2, 10, { align: "center" });

    // Right: date + match status
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(String(date), pageW - 10, 8, { align: "right" });
    doc.setFontSize(8);
    doc.text(matchLabel, pageW - 10, 14, { align: "right" });

    // Separator
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(10, headerH - 1, pageW - 10, headerH - 1);

    // ── Image area ──
    const isPlaceholder = r.is_placeholder === true;
    let imageAdded = false;

    if (!isPlaceholder && r.storage_path) {
      try {
        const signedUrl = await getSignedReceiptUrl(r.storage_path);
        if (signedUrl) {
          const resp = await fetch(signedUrl);
          const blob = await resp.blob();
          const base64 = await new Promise<string>((res) => {
            const reader = new FileReader();
            reader.onload = () => res((reader.result as string).split(",")[1]);
            reader.readAsDataURL(blob);
          });

          let imgFormat = "JPEG";
          if (blob.type === "image/png") imgFormat = "PNG";
          else if (blob.type === "image/webp") imgFormat = "WEBP";

          // Get image dimensions to maintain aspect ratio
          const imgDataUrl = `data:${blob.type};base64,${base64}`;
          const dims = await new Promise<{ w: number; h: number }>((res) => {
            const img = new Image();
            img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => res({ w: imgMaxW, h: imgMaxH });
            img.src = imgDataUrl;
          });

          const ratio = Math.min(imgMaxW / dims.w, imgMaxH / dims.h);
          const w = dims.w * ratio;
          const h = dims.h * ratio;
          const x = (pageW - w) / 2;
          const y = imgAreaTop + (imgAreaH - h) / 2;

          doc.addImage(base64, imgFormat, x, y, w, h, undefined, "MEDIUM");
          imageAdded = true;
        }
      } catch {
        // fall through to placeholder rendering
      }
    }

    if (!imageAdded) {
      // Placeholder box
      doc.setFillColor(249, 250, 251);
      doc.roundedRect(20, imgAreaTop + 20, pageW - 40, 80, 4, 4, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(156, 163, 175);
      doc.text("PLACEHOLDER RECEIPT", pageW / 2, imgAreaTop + 50, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const txVendor = r.transaction?.vendor_normalized ?? vendor;
      const txAmt = fmt(r.transaction?.amount ?? amount);
      const txDate = r.transaction?.transaction_date ?? date;
      doc.text(`${txDate}  •  ${txVendor}  •  ${txAmt}`, pageW / 2, imgAreaTop + 62, {
        align: "center",
      });
    }

    // ── Footer ──
    doc.setDrawColor(209, 213, 219);
    doc.setLineWidth(0.3);
    doc.line(10, pageH - footerH, pageW - 10, pageH - footerH);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(`Receipt ${i + 1} of ${total}`, 10, pageH - 5);
    doc.text(catName, pageW - 10, pageH - 5, { align: "right" });
  }

  // 5. Download
  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);
  const periodName = period.name.replace(/\s+/g, "-").toLowerCase();
  const dateStr = new Date().toISOString().slice(0, 10);
  const newTab = window.open(blobUrl, "_blank");

  if (!newTab) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `receipt-review-${periodName}-${dateStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
}
