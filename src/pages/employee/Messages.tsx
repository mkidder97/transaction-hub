import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, ExternalLink, Send, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface MessageRow {
  id: string;
  message: string;
  is_read: boolean;
  created_at: string;
  receipt_id: string | null;
  transaction_id: string | null;
  sender_id: string;
  recipient_id: string;
  sender: { full_name: string | null } | null;
  recipient: { full_name: string | null } | null;
  transaction: {
    vendor_normalized: string | null;
    vendor_raw: string | null;
    amount: number | null;
    transaction_date: string | null;
  } | null;
}

interface Thread {
  transaction_id: string;
  vendor: string;
  amount: number | null;
  date: string | null;
  messages: MessageRow[];
  unreadCount: number;
  latestMessage: MessageRow;
  otherParticipantName: string;
  otherParticipantId: string;
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

const fmt = (n: number | null) =>
  n != null ? `$${Number(n).toFixed(2)}` : "";

const Messages = () => {
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("receipt_messages")
      .select(
        "id, message, is_read, created_at, receipt_id, transaction_id, sender_id, recipient_id, sender:profiles!receipt_messages_sender_id_fkey(full_name), recipient:profiles!receipt_messages_recipient_id_fkey(full_name), transaction:transactions!receipt_messages_transaction_id_fkey(vendor_normalized, vendor_raw, amount, transaction_date)"
      )
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    setMessages((data as MessageRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Group messages into threads by transaction_id
  const threads: Thread[] = (() => {
    const groups = new Map<string, MessageRow[]>();
    for (const m of messages) {
      const key = m.transaction_id ?? m.id; // fallback for messages without transaction
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    return Array.from(groups.entries())
      .map(([txId, msgs]) => {
        const sorted = [...msgs].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const latest = sorted[sorted.length - 1];
        const unreadCount = msgs.filter(
          (m) => !m.is_read && m.recipient_id === user?.id
        ).length;

        // Find the "other" participant
        const otherMsg = msgs.find((m) => m.sender_id !== user?.id) ?? msgs[0];
        const otherParticipantName =
          otherMsg.sender_id !== user?.id
            ? otherMsg.sender?.full_name ?? "Unknown"
            : otherMsg.recipient?.full_name ?? "Unknown";
        const otherParticipantId =
          otherMsg.sender_id !== user?.id
            ? otherMsg.sender_id
            : otherMsg.recipient_id;

        const tx = msgs.find((m) => m.transaction)?.transaction;

        return {
          transaction_id: txId,
          vendor: tx?.vendor_normalized ?? tx?.vendor_raw ?? "Unknown",
          amount: tx?.amount ?? null,
          date: tx?.transaction_date ?? null,
          messages: sorted,
          unreadCount,
          latestMessage: latest,
          otherParticipantName,
          otherParticipantId,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.latestMessage.created_at).getTime() -
          new Date(a.latestMessage.created_at).getTime()
      );
  })();

  const currentThread = threads.find((t) => t.transaction_id === activeThread);

  // Mark thread messages as read when opened
  useEffect(() => {
    if (!currentThread || !user) return;
    const unreadIds = currentThread.messages
      .filter((m) => !m.is_read && m.recipient_id === user.id)
      .map((m) => m.id);
    if (unreadIds.length === 0) return;

    (supabase as any)
      .from("receipt_messages")
      .update({ is_read: true })
      .in("id", unreadIds)
      .then(() => {
        setMessages((prev) =>
          prev.map((m) =>
            unreadIds.includes(m.id) ? { ...m, is_read: true } : m
          )
        );
      });
  }, [activeThread, currentThread, user]);

  // Scroll to bottom when thread opens or new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentThread?.messages.length, activeThread]);

  const handleReply = async () => {
    if (!replyText.trim() || !currentThread || !user) return;
    setSending(true);
    const { error } = await (supabase as any)
      .from("receipt_messages")
      .insert({
        sender_id: user.id,
        recipient_id: currentThread.otherParticipantId,
        transaction_id: currentThread.transaction_id,
        message: replyText.trim(),
      });
    setSending(false);
    if (error) {
      toast.error("Failed to send reply");
      return;
    }
    setReplyText("");
    await fetchMessages();
  };

  const handleViewTransaction = (txId: string) => {
    if (role === "admin") {
      navigate(`/admin/matching?tab=no-receipt`);
    } else {
      navigate(`/employee/transactions?tx=${txId}`);
    }
  };

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

  // Thread detail view
  if (activeThread && currentThread) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => { setActiveThread(null); setReplyText(""); }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {currentThread.vendor}
              {currentThread.amount != null && ` · ${fmt(currentThread.amount)}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              Conversation with {currentThread.otherParticipantName}
              {currentThread.date && ` · ${currentThread.date}`}
            </p>
          </div>
          {currentThread.transaction_id && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs shrink-0"
              onClick={() => handleViewTransaction(currentThread.transaction_id)}
            >
              <ExternalLink className="h-3 w-3" />
              View Transaction
            </Button>
          )}
        </div>

        {/* Messages */}
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {currentThread.messages.map((m) => {
            const isMe = m.sender_id === user?.id;
            return (
              <div
                key={m.id}
                className={`flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 space-y-1 ${
                    isMe
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {isMe ? "You" : m.sender?.full_name ?? "Unknown"}
                    </span>
                    <span className={`text-[10px] ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {timeAgo(m.created_at)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{m.message}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply input */}
        <div className="flex gap-2 items-end border-t pt-3">
          <Textarea
            placeholder="Type a reply…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            className="flex-1 min-h-[60px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleReply();
              }
            }}
          />
          <Button
            size="icon"
            disabled={sending || !replyText.trim()}
            onClick={handleReply}
            className="shrink-0"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Thread list view
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Messages</h1>

      {threads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <MessageSquare className="h-10 w-10" />
            <p className="text-sm">No messages</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Card
              key={t.transaction_id}
              className={`cursor-pointer transition-colors hover:border-primary/30 ${
                t.unreadCount > 0 ? "bg-primary/5 border-primary/20" : ""
              }`}
              onClick={() => setActiveThread(t.transaction_id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">
                        {t.vendor}
                        {t.amount != null && ` · ${fmt(t.amount)}`}
                      </span>
                      {t.unreadCount > 0 && (
                        <Badge className="text-[10px] h-5 px-1.5">
                          {t.unreadCount}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      with {t.otherParticipantName}
                      {t.date && ` · ${t.date}`}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {t.latestMessage.sender_id === user?.id ? "You: " : ""}
                      {t.latestMessage.message}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {timeAgo(t.latestMessage.created_at)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Messages;
