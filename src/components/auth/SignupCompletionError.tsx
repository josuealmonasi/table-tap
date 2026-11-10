"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

/** Verification stays valid when provisioning needs another try. */
export default function SignupCompletionError() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="tt-login"><div className="container"><div className="tt-login-card" role="alert">
    <p>{t("auth.signupFinishFailed")}</p>
    <button className="tt-btn" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{t("fallback.retry")}</button>
    <p><Link href="/login">{t("auth.backToSignIn")}</Link></p>
  </div></div></div>;
}
