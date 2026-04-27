"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { LogoSvg } from "@/components/LogoSvg";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = supabaseBrowser();
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/confirm`,
      },
    });
    if (error) { setErrMsg(error.message); setStatus("error"); }
    else setStatus("sent");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md bg-white border border-border rounded-2xl p-8 shadow-sm">
        <div className="text-ink mb-6 flex justify-center">
          <LogoSvg className="h-14 w-auto" />
        </div>
        <h1 className="text-xl font-semibold text-ink text-center mb-1">
          Sign in to Fragranza Organizer
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          We'll email you a magic link — no password.
        </p>

        {status === "sent" ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">✉️</div>
            <p className="text-ink font-medium">Check your inbox</p>
            <p className="text-sm text-gray-500 mt-1">
              We sent a sign-in link to <span className="font-medium">{email}</span>.
            </p>
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-ink focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full py-3 bg-accent hover:bg-accent-dark text-white font-semibold rounded-lg transition disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-600 text-center">{errMsg}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
