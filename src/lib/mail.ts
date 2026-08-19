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
}

export type MailResult = { sent: true } | { sent: false; reason: "unconfigured" | "failed" };

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
      }),
    });
    if (!res.ok) {
      console.error("receipt mail failed", res.status, await res.text().catch(() => ""));
      return { sent: false, reason: "failed" };
    }
    return { sent: true };
  } catch (err) {
    console.error("receipt mail error", err);
    return { sent: false, reason: "failed" };
  }
}
