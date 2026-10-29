import { printableReceipt } from "@/lib/print-document";
import { printWhenReady } from "@/lib/print-window";

export interface ReceiptPopup {
  print: (html: string, title: string) => void;
  close: () => void;
}

/** Reserve during the click; a slow receipt read can outlast user activation. */
export function reserveReceiptPopup(onError: (reason: "blocked" | "failed") => void): ReceiptPopup {
  let popup: Window | null = null;
  const close = (): void => {
    try { popup?.close(); } catch { /* Closing paper must never interrupt a sale. */ }
    popup = null;
  };
  try {
    popup = window.open("", "_blank", "width=380,height=640");
    if (popup) popup.opener = null;
  } catch { close(); }

  return {
    close,
    print(html, title): void {
      if (!popup) {
        // A blocked pop-up must not look like a printed ticket.
        onError("blocked");
        return;
      }
      try {
        if (popup.closed) throw new Error("Receipt window closed");
        popup.document.write(printableReceipt(html, title));
        popup.document.close();
        popup.focus();
        printWhenReady(popup);
        // The printed window stays open; cleanup only closes unused paper.
        popup = null;
      } catch {
        close();
        onError("failed");
      }
    },
  };
}
