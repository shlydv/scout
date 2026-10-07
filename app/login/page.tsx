"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";

export default function LoginPage() {
  const { session, ready, signInWithGoogle, signInWithPhone, verifyOtp } = useAuth();
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && session) router.replace("/profile");
  }, [ready, session, router]);

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithPhone(phone);
      setStep("otp");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await verifyOtp(phone, otp);
      router.replace("/profile");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-(--color-bg) px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <Link href="/" className="mb-10 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-(--color-fg) font-display text-lg text-(--color-bg)">
            S
          </span>
          <span className="font-display text-xl text-(--color-fg)">Scout</span>
        </Link>

        <h1 className="font-display text-3xl leading-tight text-(--color-fg)">
          Sign in to Scout
        </h1>
        <p className="mt-2 text-sm text-(--color-fg-muted)">
          Save searches and keep track of your favorite finds. Search is free for everyone.
        </p>

        <div className="mt-8 space-y-3">
          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-(--color-line-strong) bg-(--color-panel) px-4 py-3 text-sm font-medium text-(--color-fg) shadow-sm transition hover:border-(--color-fg-muted) hover:shadow-md disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.25-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-(--color-line)" />
            <span className="text-[11px] text-(--color-fg-dim)">or</span>
            <div className="h-px flex-1 bg-(--color-line)" />
          </div>

          {/* Phone OTP */}
          {step === "phone" ? (
            <form onSubmit={handleSendOtp} className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-(--color-fg-muted)">
                  Mobile number
                </label>
                <div className="flex overflow-hidden rounded-xl border border-(--color-line-strong)">
                  <span className="flex items-center border-r border-(--color-line-strong) bg-(--color-bg-soft) px-3 text-sm text-(--color-fg-muted)">
                    +91
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98765 43210"
                    className="min-h-[46px] flex-1 bg-(--color-bg) px-3 text-sm text-(--color-fg) outline-none placeholder:text-(--color-fg-dim)"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="w-full rounded-xl bg-(--color-fg) py-3 text-sm font-semibold text-(--color-bg) transition hover:opacity-90 disabled:opacity-40"
              >
                {loading ? "Sending…" : "Send OTP"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-(--color-fg-muted)">
                  Enter the 6-digit code sent to +91{phone}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="min-h-[46px] w-full rounded-xl border border-(--color-line-strong) bg-(--color-panel) px-4 text-center text-lg tracking-[0.4em] text-(--color-fg) outline-none placeholder:text-(--color-fg-dim) focus:border-(--color-accent)"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full rounded-xl bg-(--color-fg) py-3 text-sm font-semibold text-(--color-bg) transition hover:opacity-90 disabled:opacity-40"
              >
                {loading ? "Verifying…" : "Verify & sign in"}
              </button>
              <button
                type="button"
                onClick={() => { setStep("phone"); setOtp(""); setError(null); }}
                className="w-full text-center text-[12px] text-(--color-fg-dim) hover:text-(--color-fg)"
              >
                ← Use a different number
              </button>
            </form>
          )}

          {error ? (
            <p className="rounded-lg border border-(--color-bad)/20 bg-(--color-bad)/10 px-3 py-2 text-[12px] text-(--color-bad)">
              {error}
            </p>
          ) : null}
        </div>

        <p className="mt-8 text-center text-[11px] text-(--color-fg-dim)">
          By continuing you agree to Scout's{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-(--color-fg)">terms</Link> and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-(--color-fg)">privacy policy</Link>.
        </p>
      </div>
    </main>
  );
}
