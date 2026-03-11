import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
                { type: "image_url", image_url: { url: imageUrl } },
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
    return new Response(JSON.stringify({ transactions: extracted.transactions || [] }), {
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
