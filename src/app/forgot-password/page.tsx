import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const dynamic = "force-dynamic";

// /forgot-password — request a password-reset email.
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
