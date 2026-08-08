"use client";

import { useEffect, useMemo, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  Timer,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
  KeyRound,
} from "lucide-react";
import { signInWithCustomToken, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OtpInput } from "@/components/ui/otp-input";
import { useToast } from "@/components/ui/use-toast";

interface RegistrationSession {
  email: string;
  password?: string;
  verificationToken: string;
  role: "student" | "teacher";
  name: string;
  expiresAt: number;
  resendCooldown: number;
  sendCount: number;
}

const SESSION_KEY = "greenguardian_registration_session";
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [session, setSession] = useState<RegistrationSession | null>(null);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const otpRef = useRef("");
  const verifyingRef = useRef(false);

  // Load session from sessionStorage on mount.
  useEffect(() => {
    const email = searchParams.get("email");
    let stored: RegistrationSession | null = null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = null;
    }

    if (!stored) {
      if (email) {
        // Session missing but we have an email query — show a helpful message.
        setError(
          "Your verification session has expired or is missing. Please register again to receive a new code."
        );
      } else {
        router.replace("/register");
      }
      return;
    }

    if (email && stored.email !== email) {
      setError("Verification session does not match the email provided.");
      return;
    }

    setSession(stored);
    setResendCooldown(stored.resendCooldown || RESEND_COOLDOWN_MS / 1000);
    setCountdown(Math.max(0, Math.floor((stored.expiresAt - Date.now()) / 1000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Countdown timers.
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      setCountdown(Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const emailMasked = useMemo(() => {
    if (!session) return "";
    const [local, domain] = session.email.split("@");
    if (!domain) return session.email;
    const visible = local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(0, local.length - 2))}@${domain}`;
  }, [session]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Keep the latest OTP in a ref so auto-submit closures always read the
  // current value instead of a stale one (fixes the "stuck on Verifying..." bug).
  useEffect(() => {
    otpRef.current = otp;
  }, [otp]);

  const handleVerify = async (e?: React.FormEvent, codeOverride?: string) => {
    e?.preventDefault();
    if (!session) return;
    if (verifyingRef.current) return;
    verifyingRef.current = true;

    const code = (codeOverride ?? otpRef.current).trim();
    if (code.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      verifyingRef.current = false;
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          otp: code,
          verificationToken: session.verificationToken,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Verification failed. Please try again.");
        setOtp("");
        if (res.status === 410 || res.status === 404 || res.status === 409) {
          // Session is no longer usable — clear it.
          sessionStorage.removeItem(SESSION_KEY);
        }
        return;
      }

      // Sign the browser into the account the server just created. Without
      // this, contexts/AuthContext.tsx's onAuthStateChanged listener never
      // fires and the redirect below (to a page gated on useAuth().user)
      // bounces straight back to /login.
      try {
        if (data.customToken) {
          await signInWithCustomToken(auth, data.customToken);
        } else if (data.needsPasswordSignIn && session.password) {
          await signInWithEmailAndPassword(auth, session.email, session.password);
        }
      } catch (signInErr) {
        console.error("Post-verification sign-in failed:", signInErr);
      }

      // Clear session storage (including the plaintext password, if any).
      sessionStorage.removeItem(SESSION_KEY);
      setSuccess(true);
      setOtp("");

      toast({
        title: "Email Verified!",
        description:
          data.user?.role === "teacher"
            ? "Your account is created and pending admin approval."
            : "Your account has been created successfully.",
      });

      // Redirect based on role.
      setTimeout(() => {
        if (data.user?.role === "teacher") {
          router.push("/pending-approval");
        } else if (data.user?.role === "student") {
          router.push("/dashboard/student");
        } else {
          router.push("/login");
        }
      }, 1800);
    } catch (err: any) {
      console.error("Verify error:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!session || resendCooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: session.email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.retryAfterSeconds) {
          setResendCooldown(data.retryAfterSeconds);
        }
        setError(data.error || "Failed to resend code. Please try again.");
        return;
      }

      // Update session with new token.
      const updated: RegistrationSession = {
        ...session,
        verificationToken: data.verificationToken || session.verificationToken,
        expiresAt: Date.now() + (data.expiresInSeconds || OTP_EXPIRY_MS / 1000) * 1000,
        resendCooldown: data.resendCooldownSeconds || RESEND_COOLDOWN_MS / 1000,
        sendCount: session.sendCount + 1,
      };
      setSession(updated);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(updated));
      setResendCooldown(updated.resendCooldown);
      setCountdown(Math.floor((updated.expiresAt - Date.now()) / 1000));
      setOtp("");

      toast({
        title: "Code Resent",
        description: `A new verification code was sent to ${emailMasked}.`,
      });
    } catch (err: any) {
      console.error("Resend error:", err);
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!session && !error) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ duration: 1 }}
          className="absolute -top-24 -right-24 w-64 h-64 sm:w-96 sm:h-96 bg-green-200 rounded-full blur-3xl"
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.4 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="absolute -bottom-32 -left-32 w-72 h-72 sm:w-[28rem] sm:h-[28rem] bg-emerald-200 rounded-full blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-[460px] relative z-10"
      >
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="flex justify-center mb-3 sm:mb-4"
          >
            <div className="p-3 sm:p-4 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl shadow-lg shadow-green-500/30">
              <Mail className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
            </div>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-green-700 to-emerald-600 bg-clip-text text-transparent"
          >
            Verify Your Email
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-gray-600 mt-1 sm:mt-2 text-sm sm:text-base"
          >
            We sent a 6-digit code to <span className="font-semibold text-green-700">{emailMasked || "your email"}</span>
          </motion.p>
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card className="backdrop-blur-sm bg-white/90 shadow-xl border-0 shadow-green-900/5">
            <CardHeader className="pb-4 sm:pb-6 px-4 sm:px-6 pt-4 sm:pt-6">
              <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-green-600" />
                Enter Verification Code
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                This code expires in 10 minutes and can only be used once.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
              {success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-6"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="mx-auto mb-4 w-16 h-16 rounded-full bg-green-100 flex items-center justify-center"
                  >
                    <CheckCircle2 className="h-10 w-10 text-green-600" />
                  </motion.div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">Email Verified!</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    {session?.role === "teacher"
                      ? "Your account is being prepared. Redirecting to pending approval..."
                      : "Your account has been created. Redirecting to your dashboard..."}
                  </p>
                  <div className="flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-green-600" />
                  </div>
                </motion.div>
              ) : error && !session ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-6"
                >
                  <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                    <AlertTriangle className="h-7 w-7 text-amber-600" />
                  </div>
                  <p className="text-sm text-gray-600 mb-4">{error}</p>
                  <Link href="/register" passHref>
                    <Button className="w-full">
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Registration
                    </Button>
                  </Link>
                </motion.div>
              ) : (
                <form onSubmit={handleVerify} className="space-y-4 sm:space-y-5">
                  {/* OTP Input */}
                  <OtpInput
                    length={6}
                    value={otp}
                    onChange={(v) => {
                      setOtp(v);
                      setError(null);
                      // Auto-submit when 6 digits are entered.
                      if (v.length === 6) {
                        setTimeout(() => {
                          setVerifying(true);
                          handleVerify();
                        }, 150);
                      }
                    }}
                    disabled={verifying}
                    error={!!error}
                    autoFocus
                  />

                  {/* Error message */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3"
                      >
                        <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-red-700">{error}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Countdown + Resend */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
                    <div className="flex items-center text-sm text-gray-600">
                      <Timer className="h-4 w-4 mr-1.5 text-green-600" />
                      <span>
                        {countdown > 0 ? (
                          <>
                            Code expires in{" "}
                            <span className="font-bold text-green-700 tabular-nums">{formatTime(countdown)}</span>
                          </>
                        ) : (
                          <span className="text-red-600 font-medium">Code expired</span>
                        )}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendCooldown > 0 || loading}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 hover:text-green-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      {resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Resend Code"}
                    </button>
                  </div>

                  {/* Verify Button */}
                  <Button
                    type="submit"
                    disabled={verifying || otp.length !== 6}
                    className="w-full h-11 sm:h-12 text-sm sm:text-base font-medium bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg shadow-green-600/25 mt-2"
                  >
                    {verifying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify & Create Account"
                    )}
                  </Button>

                  {/* Help */}
                  <p className="text-center text-xs text-gray-500">
                    Didn&apos;t receive the email? Check your spam folder or{" "}
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendCooldown > 0}
                      className="text-green-600 hover:text-green-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      resend the code
                    </button>
                  </p>

                  <div className="text-center">
                    <Link
                      href="/register"
                      className="text-xs text-gray-500 hover:text-green-600 transition-colors inline-flex items-center gap-1"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      Use a different email
                    </Link>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-center text-xs text-gray-500 mt-4 sm:mt-6"
        >
          Protected by GreenGuardian Security
        </motion.p>
      </motion.div>
    </div>
  );
}

function VerifyEmailFallback() {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-emerald-50 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-green-600" />
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailContent />
    </Suspense>
  );
}


