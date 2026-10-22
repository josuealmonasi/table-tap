interface AuthFailure { code?: string; status?: number }

/** Provider wording changes and is English. Codes give both languages one rule. */
export function authErrorKey(error: AuthFailure, recovery = false): string | null {
  // Recovery gives one answer whatever the provider says. Supabase rate-limits
  // and mails only existing addresses, so its 429 or a failed delivery would
  // tell anyone which emails have accounts; a missing one answers success.
  // Only a request that got no answer at all (the form's catch) is reported.
  if (recovery) return null;
  if (error.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code ?? "")) return "auth.rateLimited";
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
