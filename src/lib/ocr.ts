import Tesseract from "tesseract.js";

export interface OcrResult {
  vendor_extracted: string | null;
  amount_extracted: number | null;
  date_extracted: string | null;
  ai_confidence: number;
  ai_raw_text: string;
}

function extractAmount(text: string): number | null {
  // Match patterns like $12.34, $ 12.34, 12.34, with optional thousands separators
  const patterns = [
    /\$\s?([\d,]+\.\d{2})\b/,
    /total[:\s]*\$?\s?([\d,]+\.\d{2})/i,
    /amount[:\s]*\$?\s?([\d,]+\.\d{2})/i,
    /due[:\s]*\$?\s?([\d,]+\.\d{2})/i,
    /balance[:\s]*\$?\s?([\d,]+\.\d{2})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return parseFloat(m[1].replace(/,/g, ""));
  }
  return null;
}

function extractDate(text: string): string | null {
  const patterns = [
    // MM/DD/YYYY or MM-DD-YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|\d{2})\b/,
    // Month DD, YYYY
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2}),?\s+(20\d{2})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const raw = m[0];
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
        // Fallback for MM/DD/YY
        if (m.length >= 4) {
          let year = m[3];
          if (year.length === 2) year = "20" + year;
          const month = m[1].padStart(2, "0");
          const day = m[2].padStart(2, "0");
          return `${year}-${month}-${day}`;
        }
      } catch {
        /* skip */
      }
    }
  }
  return null;
}

function extractVendor(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60);
  // First non-trivial line is often the store/vendor name
  for (const line of lines.slice(0, 5)) {
    // Skip lines that are mostly numbers or dates
    if (/^\d/.test(line)) continue;
    if (/^(total|subtotal|tax|amount|date|receipt|order)/i.test(line)) continue;
    return line;
  }
  return lines[0] ?? null;
}

export async function runOcr(
  imageSource: string,
  onProgress?: (progress: number) => void,
): Promise<OcrResult> {
  const result = await Tesseract.recognize(imageSource, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(m.progress);
      }
    },
  });

  const rawText = result.data.text;
  const vendor = extractVendor(rawText);
  const amount = extractAmount(rawText);
  const date = extractDate(rawText);

  let found = 0;
  if (vendor) found++;
  if (amount) found++;
  if (date) found++;
  const confidence = Math.round((found / 3) * 100) / 100;

  return {
    vendor_extracted: vendor,
    amount_extracted: amount,
    date_extracted: date,
    ai_confidence: confidence,
    ai_raw_text: rawText,
  };
}
