"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function sendLink() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="tt-login">
      <div className="tt-login-card">
        <div style={{ fontSize: 32 }}>🌸</div>
        <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>TableTap Dashboard</h1>
        <p className="tt-muted" style={{ marginTop: 0 }}>Sign in to manage orders</p>

        {sent ? (
          <div className="tt-login-sent">
            ✓ Check your email — we sent a magic sign-in link to <strong>{email}</strong>.
          </div>
        ) : (
          <>
            <input
              className="tt-input"
              type="email"
              placeholder="you@restaurant.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <button
              className="tt-btn tt-btn-primary"
              style={{ width: "100%" }}
              disabled={!email || loading}
              onClick={sendLink}
            >
              {loading ? "Sending…" : "Send magic link"}
            </button>
            {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
