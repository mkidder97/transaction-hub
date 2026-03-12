import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { imageUrl, categories } = await req.json();
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

    // Build category name list and lookup map
    const categoryNames: string[] = [];
    const categoryMap: Record<string, string> = {}; // name -> id
    if (Array.isArray(categories)) {
      for (const c of categories) {
        if (c.name && c.id) {
          categoryNames.push(c.name);
          categoryMap[c.name.toLowerCase()] = c.id;
        }
      }
    }

    // Download the image from storage (handles private buckets)
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let imageDataUri: string;

    const imgResponse = await fetch(imageUrl.replace("/object/public/", "/object/"), {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY!,
      },
    });

    if (!imgResponse.ok) {
      const fallback = await fetch(imageUrl);
      if (!fallback.ok) {
        throw new Error(`Failed to download image: ${fallback.status}`);
      }
      const bytes = new Uint8Array(await fallback.arrayBuffer());
      const b64 = base64Encode(bytes);
      imageDataUri = `data:image/jpeg;base64,${b64}`;
    } else {
      const bytes = new Uint8Array(await imgResponse.arrayBuffer());
      const b64 = base64Encode(bytes);
      imageDataUri = `data:image/jpeg;base64,${b64}`;
    }

    // Build tool parameters — include category if categories provided
    const toolProperties: Record<string, any> = {
      vendor: {
        type: "string",
        description: "The store or vendor name shown on the receipt",
      },
      amount: {
        type: "number",
        description: "The total amount on the receipt in dollars (e.g. 42.99)",
      },
      date: {
        type: "string",
        description: "The transaction date in YYYY-MM-DD format",
      },
      confidence: {
        type: "number",
        description: "Confidence score from 0 to 1 for the extraction quality",
      },
    };
    const requiredFields = ["vendor", "amount", "date", "confidence"];

    if (categoryNames.length > 0) {
      toolProperties.category = {
        type: "string",
        description: "The expense category that best fits this receipt",
        enum: categoryNames,
      };
      requiredFields.push("category");
    }

    const systemContent = categoryNames.length > 0
      ? `You are a receipt data extraction assistant. Extract the vendor name, total amount, transaction date, and expense category from receipt images. Available categories: ${categoryNames.join(", ")}. Always use the extract_receipt_data tool to return structured data.`
      : "You are a receipt data extraction assistant. Extract the vendor name, total amount, and transaction date from receipt images. Always use the extract_receipt_data tool to return structured data.";

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
            { role: "system", content: systemContent },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageDataUri } },
                {
                  type: "text",
                  text: categoryNames.length > 0
                    ? `Extract the vendor/store name, total amount (as a number), date (as YYYY-MM-DD), and the best matching expense category from this receipt image. Categories: ${categoryNames.join(", ")}.`
                    : "Extract the vendor/store name, total amount (as a number), and date (as YYYY-MM-DD) from this receipt image.",
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_receipt_data",
                description: "Extract structured receipt data from an image.",
                parameters: {
                  type: "object",
                  properties: toolProperties,
                  required: requiredFields,
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "extract_receipt_data" },
          },
        }),
      },
    );

    if (!response.ok) {
      const status = response.status;
      const body = await response.text();

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds in workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      console.error("AI gateway error:", status, body);
      return new Response(
        JSON.stringify({ error: "AI extraction failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response:", JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: "AI did not return structured data" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    // Map category name back to ID
    let suggestedCategoryId: string | null = null;
    if (extracted.category && categoryMap[extracted.category.toLowerCase()]) {
      suggestedCategoryId = categoryMap[extracted.category.toLowerCase()];
    }

    return new Response(
      JSON.stringify({
        vendor_extracted: extracted.vendor || null,
        amount_extracted: typeof extracted.amount === "number" ? extracted.amount : null,
        date_extracted: extracted.date || null,
        ai_confidence: typeof extracted.confidence === "number" ? extracted.confidence : 0.5,
        suggested_category_id: suggestedCategoryId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("extract-receipt error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
