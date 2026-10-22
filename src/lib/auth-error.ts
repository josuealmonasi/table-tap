interface AuthFailure { code?: string; status?: number }

/** Provider wording changes and is English. Codes give both languages one rule. */
export function authErrorKey(error: AuthFailure, recovery = false): string | null {
  if (error.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code ?? "")) return "auth.rateLimited";
  // Recovery must give the same answer for a missing and an existing account.
  if (recovery && ["user_not_found", "email_not_confirmed", "invalid_credentials"].includes(error.code ?? "")) return null;
  switch (error.code) {
    case "invalid_credentials": return "auth.invalidCredentials";
    case "email_not_confirmed": return "auth.emailUnconfirmed";
    case "same_password": return "auth.samePassword";
    case "weak_password": return "auth.weakPassword";
    case "session_not_found":
    case "session_expired":
    case "otp_expired": return "auth.linkInvalid";
    default: return "auth.unavailable";
  }
}
