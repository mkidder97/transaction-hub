import Tesseract from "tesseract.js";

export interface OcrResult {
  vendor_extracted: string | null;
  amount_extracted: number | null;
  date_extracted: string | null;
  ai_confidence: number;
  ai_raw_text: string;
}

// ─── Image Preprocessing ───────────────────────────────────────────────

const MIN_LONG_SIDE = 1500;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for preprocessing"));
    img.src = src;
  });
}

function applyGrayscaleAndContrast(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  contrastFactor: number,
) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    // Weighted luminance
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Contrast stretch around midpoint 128
    const val = Math.min(255, Math.max(0, contrastFactor * (gray - 128) + 128));
    d[i] = d[i + 1] = d[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);
}

function applySharpen(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const sd = src.data;
  const dd = dst.data;

  // 3×3 sharpen kernel
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          sum += sd[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
        }
      }
      const idx = (y * w + x) * 4;
      const v = Math.min(255, Math.max(0, sum));
      dd[idx] = dd[idx + 1] = dd[idx + 2] = v;
      dd[idx + 3] = 255;
    }
  }
  // Copy edge pixels as-is
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const idx = (y * w + x) * 4;
      dd[idx] = sd[idx]; dd[idx + 1] = sd[idx + 1]; dd[idx + 2] = sd[idx + 2]; dd[idx + 3] = 255;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) {
      const idx = (y * w + x) * 4;
      dd[idx] = sd[idx]; dd[idx + 1] = sd[idx + 1]; dd[idx + 2] = sd[idx + 2]; dd[idx + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

export async function preprocessImage(imageUrl: string): Promise<string> {
  const img = await loadImage(imageUrl);
  let { width: w, height: h } = img;

  // Scale up if too small
  const longSide = Math.max(w, h);
  if (longSide < MIN_LONG_SIDE) {
    const scale = MIN_LONG_SIDE / longSide;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);

  applyGrayscaleAndContrast(ctx, w, h, 1.4); // ~40% contrast boost
  applySharpen(ctx, w, h);

  return canvas.toDataURL("image/png");
}

// ─── Extraction helpers ────────────────────────────────────────────────

const AMOUNT_RE = /\$\s?([\d,]+\.\d{2})\b/g;
const TOTAL_LABELS =
  /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total|amount|due)\b/i;

function extractAmount(text: string): number | null {
  const lines = text.split("\n");

  // Pass 1: look for labeled total lines
  const labeledAmounts: number[] = [];
  for (const line of lines) {
    if (TOTAL_LABELS.test(line)) {
      const matches = [...line.matchAll(AMOUNT_RE)];
      for (const m of matches) {
        const v = parseFloat(m[1].replace(/,/g, ""));
        if (v >= 1) labeledAmounts.push(v);
      }
    }
  }
  // Prefer the last labeled total (receipts often list subtotal then total)
  if (labeledAmounts.length > 0) return labeledAmounts[labeledAmounts.length - 1];

  // Pass 2: collect all dollar amounts, pick the largest ≥ $1
  const allAmounts: number[] = [];
  const allMatches = [...text.matchAll(AMOUNT_RE)];
  for (const m of allMatches) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    if (v >= 1) allAmounts.push(v);
  }
  if (allAmounts.length > 0) return Math.max(...allAmounts);

  return null;
}

const ADDRESS_RE = /\d+.*\b(st|ave|rd|blvd|dr|ln|ct|way|pkwy|hwy|suite|ste|apt)\b/i;
const NOISE_RE =
  /\b(receipt|welcome|thank\s*you|customer\s*copy|store\s*#|store\s*no|tel[:\s]|phone|fax|www\.|\.com|http)/i;
const DATE_LIKE_RE = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/;

function extractVendor(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60);

  // Collect candidates from first 8 lines
  const candidates: string[] = [];
  for (const line of lines.slice(0, 8)) {
    if (/^\d/.test(line)) continue;
    if (ADDRESS_RE.test(line)) continue;
    if (NOISE_RE.test(line)) continue;
    if (DATE_LIKE_RE.test(line)) continue;
    if (/^(total|subtotal|tax|amount|date|order)/i.test(line)) continue;
    candidates.push(line);
  }

  // Prefer all-caps lines between 3-30 chars
  const allCaps = candidates.filter(
    (l) => l.length >= 3 && l.length <= 30 && l === l.toUpperCase() && /[A-Z]/.test(l),
  );
  if (allCaps.length > 0) return allCaps[0];

  return candidates[0] ?? lines[0] ?? null;
}

const MONTHS =
  "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

function extractDate(text: string): string | null {
  const lines = text.split("\n");

  // Date patterns
  const patterns: RegExp[] = [
    // MM/DD/YYYY or MM-DD-YYYY or MM/DD/YY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|\d{2})\b/,
    // Month DD, YYYY  or  Month DD YYYY  or  Month. DD
    new RegExp(
      `(${MONTHS})\\w*\\.?\\s+(\\d{1,2}),?\\s*(20\\d{2}|\\d{2})?`,
      "i",
    ),
  ];

  const LABEL_RE = /\b(date|transaction\s*date|visit|dated)\b/i;

  // Pass 1: prefer dates near a label
  for (const line of lines) {
    if (!LABEL_RE.test(line)) continue;
    for (const p of patterns) {
      const m = line.match(p);
      if (m) {
        const parsed = parseMatchedDate(m);
        if (parsed) return parsed;
      }
    }
  }

  // Pass 2: any date found in the text
  for (const line of lines) {
    for (const p of patterns) {
      const m = line.match(p);
      if (m) {
        const parsed = parseMatchedDate(m);
        if (parsed) return parsed;
      }
    }
  }

  return null;
}

function parseMatchedDate(m: RegExpMatchArray): string | null {
  try {
    const raw = m[0];
    // Try native parse first
    const d = new Date(raw);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2099) {
      return d.toISOString().split("T")[0];
    }
    // Manual parse for MM/DD/YY(YY)
    if (m.length >= 4 && /\d/.test(m[1])) {
      let year = m[3] ?? "";
      if (!year) return null;
      if (year.length === 2) year = "20" + year;
      const month = m[1].padStart(2, "0");
      const day = m[2].padStart(2, "0");
      const yr = parseInt(year, 10);
      const mo = parseInt(month, 10);
      const dy = parseInt(day, 10);
      if (yr >= 2000 && yr <= 2099 && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) {
        return `${year}-${month}-${day}`;
      }
    }
  } catch {
    /* skip */
  }
  return null;
}

// ─── Tesseract OCR ─────────────────────────────────────────────────────

export async function runOcrRaw(
  imageSource: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  // Preprocess image before recognition
  const processed = await preprocessImage(imageSource);

  const result = await Tesseract.recognize(processed, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(m.progress);
      }
    },
  });
  return result.data.text;
}

export async function runOcr(
  imageSource: string,
  onProgress?: (progress: number) => void,
): Promise<OcrResult> {
  const rawText = await runOcrRaw(imageSource, onProgress);
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

// ─── Transaction parsing (unchanged signatures) ────────────────────────

export interface ParsedTransaction {
  vendor: string;
  date: string;
  amount: number;
}

const SKIP_PATTERNS = /sort by|transactions|filter|card ending|present|balance/i;

export function parseTransactionList(rawText: string): ParsedTransaction[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const results: ParsedTransaction[] = [];

  const dateRe = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+\d{4}\b/i;
  const amountRe = /\$\s?([\d,]+\.\d{2})/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (SKIP_PATTERNS.test(line)) { i++; continue; }

    const isVendorCandidate = line.length > 2 && !/^\d/.test(line) && !/^\$/.test(line);

    if (isVendorCandidate) {
      let foundDate: string | null = null;
      let foundAmount: number | null = null;
      let lastConsumed = i;

      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const ahead = lines[j];
        if (!foundDate) {
          const dm = ahead.match(dateRe);
          if (dm) {
            const d = new Date(dm[0]);
            if (!isNaN(d.getTime())) {
              foundDate = d.toISOString().split("T")[0];
              if (j > lastConsumed) lastConsumed = j;
            }
          }
        }
        if (foundAmount === null) {
          const am = ahead.match(amountRe);
          if (am) {
            foundAmount = parseFloat(am[1].replace(/,/g, ""));
            if (j > lastConsumed) lastConsumed = j;
          }
        }
      }

      if (!foundDate) {
        const dm = line.match(dateRe);
        if (dm) {
          const d = new Date(dm[0]);
          if (!isNaN(d.getTime())) foundDate = d.toISOString().split("T")[0];
        }
      }
      if (foundAmount === null) {
        const am = line.match(amountRe);
        if (am) foundAmount = parseFloat(am[1].replace(/,/g, ""));
      }

      if (foundDate && foundAmount !== null) {
        results.push({ vendor: line.replace(dateRe, "").replace(amountRe, "").trim() || line, date: foundDate, amount: foundAmount });
        i = lastConsumed + 1;
        continue;
      }
    }
    i++;
  }

  return results;
}

export interface ParsedTransactionRow {
  date: string;
  vendor: string;
  amount: string;
  card_last_four: string;
}

export function parseTransactionRows(rawText: string): ParsedTransactionRow[] {
  const lines = rawText.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
  const rows: ParsedTransactionRow[] = [];

  const dateRe = /(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2}|\d{2})/;
  const amountRe = /\$?\s?([\d,]+\.\d{2})/;

  for (const line of lines) {
    const dateMatch = line.match(dateRe);
    const amountMatch = line.match(amountRe);
    if (!dateMatch || !amountMatch) continue;

    let year = dateMatch[3];
    if (year.length === 2) year = "20" + year;
    const dateStr = `${year}-${dateMatch[1].padStart(2, "0")}-${dateMatch[2].padStart(2, "0")}`;

    const amountVal = amountMatch[1].replace(/,/g, "");

    const dateEnd = dateMatch.index! + dateMatch[0].length;
    const amountStart = amountMatch.index!;
    let vendor = line.slice(dateEnd, amountStart).trim();
    if (!vendor) {
      vendor = line.slice(amountMatch.index! + amountMatch[0].length).trim();
    }
    vendor = vendor.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();
    if (!vendor) vendor = "Unknown";

    rows.push({ date: dateStr, vendor, amount: amountVal, card_last_four: "" });
  }

  return rows;
}
