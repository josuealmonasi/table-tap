/**
 * Sending mail, with an honest answer when we cannot.
 *
 * There is no mail provider wired into this app yet, and pretending otherwise
 * would be worse than saying so: a receipt that silently vanishes is a diner
 * standing at a table wondering where their email went. Without a key the
 * sender reports that it did not send, the caller tells the truth, and the day
 * somebody adds RESEND_API_KEY every receipt starts arriving with no code
 * change at all.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Shown as the sender's name — the restaurant, not us. */
  fromName?: string;
  /** One send, even when its first reply is lost on the way back. */
  idempotencyKey?: string;
  /** Files sent with it, such as the ticket's PDF. */
  attachments?: { filename: string; content: Buffer }[];
  /** Extra headers, such as List-Unsubscribe. */
  headers?: Record<string, string>;
}

/**
 * A failure says whether trying again can help: a 429, a 5xx, a dropped
 * connection or an idempotent request still in flight may succeed later; a
 * validation refusal never will. `code` is the provider's error name.
 */
export type MailResult = { sent: true }
  | { sent: false; reason: "unconfigured" | "failed"; retryable?: boolean; status?: number; code?: string };

/** What a provider refusal means for a retry. */
export function mailFailure(status: number, body: string): { retryable: boolean; status: number; code?: string } {
  let code: unknown;
  try { code = (JSON.parse(body) as { name?: unknown }).name; } catch { code = undefined; }
  const retryable = status === 429 || status >= 500 || code === "concurrent_idempotent_requests";
  return { retryable, status, ...(typeof code === "string" ? { code } : {}) };
}

/** Whether mail can actually leave this deployment. */
export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RECEIPT_FROM_EMAIL);
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  if (!mailConfigured()) return { sent: false, reason: "unconfigured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        // The restaurant's name over our verified domain: the diner bought
        // from them, and a receipt signed by a company they have never heard
        // of is a receipt that gets reported as spam.
        from: `${mail.fromName ?? "TableTap"} <${process.env.RECEIPT_FROM_EMAIL}>`,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.attachments?.length
          ? { attachments: mail.attachments.map(a => ({ filename: a.filename, content: a.content.toString("base64") })) }
          : {}),
        ...(mail.headers ? { headers: mail.headers } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("receipt mail failed", res.status, body);
      return { sent: false, reason: "failed", ...mailFailure(res.status, body) };
    }
    return { sent: true };
  } catch (err) {
    console.error("receipt mail error", err);
    return { sent: false, reason: "failed", retryable: true };
  }
}
