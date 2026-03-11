import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "imageUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Extract storage path from the public URL and download via service role
    // URL format: .../storage/v1/object/public/transaction-screenshots/screenshots/uuid.jpg
    const bucketPath = imageUrl.split("/transaction-screenshots/")[1];
    if (!bucketPath) {
      throw new Error("Could not parse storage path from imageUrl");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: fileData, error: downloadErr } = await supabase.storage
      .from("transaction-screenshots")
      .download(bucketPath);

    if (downloadErr || !fileData) {
      throw new Error(`Failed to download image: ${downloadErr?.message || "No data"}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const b64 = base64Encode(new Uint8Array(arrayBuffer));
    const mimeType = bucketPath.endsWith(".png") ? "image/png" : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${b64}`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                "You are a transaction data extraction assistant. Extract all transaction rows visible in a bank/credit card statement screenshot. Each row should have: date (YYYY-MM-DD), vendor name, amount (number), and card last four digits if visible.",
            },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUri } },
                {
                  type: "text",
                  text: "Extract all transaction rows from this statement screenshot. Return each transaction with date (YYYY-MM-DD), vendor name, amount (as a number), and card_last_four (if visible, otherwise empty string).",
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_transactions",
                description: "Extract all transaction rows from a statement screenshot.",
                parameters: {
                  type: "object",
                  properties: {
                    transactions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          date: { type: "string", description: "Transaction date in YYYY-MM-DD" },
                          vendor: { type: "string", description: "Vendor or merchant name" },
                          amount: { type: "string", description: "Transaction amount as a string (e.g. '42.99')" },
                          card_last_four: { type: "string", description: "Last 4 digits of card, or empty string" },
                        },
                        required: ["date", "vendor", "amount", "card_last_four"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["transactions"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_transactions" } },
        }),
      },
    );

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", status, body);
      return new Response(JSON.stringify({ error: "AI extraction failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ error: "AI did not return structured data", transactions: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    // Sanity-check: if extracted year is >1 year in the past, adjust to current year
    const currentYear = new Date().getFullYear();
    const fixedTransactions = (extracted.transactions || []).map((tx: any) => {
      if (tx.date && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)) {
        const extractedYear = parseInt(tx.date.substring(0, 4), 10);
        if (currentYear - extractedYear > 1) {
          tx.date = `${currentYear}-${tx.date.substring(5)}`;
        }
      }
      return tx;
    });

    return new Response(JSON.stringify({ transactions: fixedTransactions }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-transactions error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
