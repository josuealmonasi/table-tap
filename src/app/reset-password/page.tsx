import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const dynamic = "force-dynamic";

// /reset-password — set a new password (reached from the email link via /auth/callback).
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
