import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageSquare, ExternalLink } from "lucide-react";

interface MessageRow {
  id: string;
  message: string;
  is_read: boolean;
  created_at: string;
  receipt_id: string | null;
  transaction_id: string | null;
  sender: { full_name: string | null } | null;
  transaction: {
    vendor_normalized: string | null;
    vendor_raw: string | null;
    amount: number | null;
    transaction_date: string | null;
  } | null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const Messages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("receipt_messages")
      .select(
        "id, message, is_read, created_at, receipt_id, transaction_id, sender:profiles!receipt_messages_sender_id_fkey(full_name), transaction:transactions!receipt_messages_transaction_id_fkey(vendor_normalized, vendor_raw, amount, transaction_date)"
      )
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false });
    setMessages((data as MessageRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const markRead = async (id: string) => {
    await (supabase as any)
      .from("receipt_messages")
      .update({ is_read: true })
      .eq("id", id);
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_read: true } : m))
    );
  };

  const handleViewTransaction = (m: MessageRow) => {
    if (!m.is_read) markRead(m.id);
    if (m.transaction_id) {
      navigate(`/employee/transactions?tx=${m.transaction_id}`);
    }
  };

  const fmt = (n: number | null) =>
    n != null ? `$${Number(n).toFixed(2)}` : "";

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Messages</h1>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Messages</h1>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <MessageSquare className="h-10 w-10" />
            <p className="text-sm">No messages</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const vendor =
              m.transaction?.vendor_normalized ??
              m.transaction?.vendor_raw ??
              null;
            return (
              <Card
                key={m.id}
                className={`transition-colors ${
                  !m.is_read ? "bg-primary/5 border-primary/20" : ""
                }`}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      From {m.sender?.full_name ?? "Admin"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(m.created_at)}
                    </span>
                  </div>
                  {vendor && (
                    <p className="text-xs text-muted-foreground">
                      re: {vendor}{" "}
                      {m.transaction?.amount != null &&
                        fmt(m.transaction.amount)}{" "}
                      {m.transaction?.transaction_date &&
                        `on ${m.transaction.transaction_date}`}
                    </p>
                  )}
                  <p className="text-sm">{m.message}</p>
                  {m.transaction_id && (
                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => handleViewTransaction(m)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        View Transaction
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Messages;
