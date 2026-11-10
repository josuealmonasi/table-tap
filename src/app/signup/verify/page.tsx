import SignupVerification from "@/components/auth/SignupVerification";

export default async function VerifySignupPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  return <SignupVerification expired={(await searchParams).error === "expired"} />;
}
