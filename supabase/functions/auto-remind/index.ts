import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if auto-reminder is enabled
    const { data: settings } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["auto_reminder_enabled", "auto_reminder_days"]);

    const settingsMap: Record<string, string> = {};
    for (const s of settings ?? []) {
      settingsMap[s.key] = s.value ?? "";
    }

    if (settingsMap.auto_reminder_enabled !== "true") {
      return new Response(JSON.stringify({ skipped: true, reason: "disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const days = parseInt(settingsMap.auto_reminder_days || "7", 10);
    if (isNaN(days) || days < 1) {
      return new Response(JSON.stringify({ skipped: true, reason: "invalid days" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().split("T")[0];

    // Find an admin to use as sender
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin")
      .limit(1);

    const adminId = admins?.[0]?.id;
    if (!adminId) {
      return new Response(JSON.stringify({ error: "No admin found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find unmatched transactions older than cutoff that have a user assigned
    const { data: transactions } = await supabase
      .from("transactions")
      .select("id, user_id, vendor_normalized, vendor_raw, amount, transaction_date")
      .eq("match_status", "unmatched")
      .not("user_id", "is", null)
      .lte("transaction_date", cutoff);

    if (!transactions || transactions.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const txIds = transactions.map((t) => t.id);

    // Check which transactions already have a reminder sent
    const { data: existingMessages } = await supabase
      .from("receipt_messages")
      .select("transaction_id")
      .in("transaction_id", txIds);

    const alreadySent = new Set((existingMessages ?? []).map((m) => m.transaction_id));

    // Filter to only unsent
    const toSend = transactions.filter((t) => !alreadySent.has(t.id));

    if (toSend.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get employee names
    const userIds = [...new Set(toSend.map((t) => t.user_id!))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    const nameMap: Record<string, string> = {};
    for (const p of profiles ?? []) {
      nameMap[p.id] = p.full_name ?? "there";
    }

    // Build messages
    const messages = toSend.map((t) => {
      const firstName = (nameMap[t.user_id!] ?? "there").split(" ")[0];
      const vendor = t.vendor_normalized ?? t.vendor_raw ?? "a vendor";
      const amount = t.amount != null ? `$${Number(t.amount).toFixed(2)}` : "";
      const date = t.transaction_date ?? "";

      return {
        sender_id: adminId,
        recipient_id: t.user_id!,
        transaction_id: t.id,
        message: `Hi ${firstName}, we're missing a receipt for your ${vendor} charge${amount ? ` of ${amount}` : ""}${date ? ` on ${date}` : ""}. Please submit it when you can.`,
      };
    });

    const { error: insertError } = await supabase
      .from("receipt_messages")
      .insert(messages);

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: messages.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
