"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Mail, Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

export default function ForgotPasswordPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Could not send the reset email.");
      }

      setSent(true);
      setDevLink(data?.devLink || null);
    } catch (error: any) {
      toast({
        title: "Reset failed",
        description: error?.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-green-100 flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-green-200/30 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-green-300/20 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-[420px]"
      >
        <div className="text-center mb-6 sm:mb-8">
          <div className="flex justify-center mb-3 sm:mb-4">
            <div className="relative">
              <div className="absolute inset-0 bg-green-400/20 rounded-full blur-xl scale-150" />
              <Shield className="relative h-10 w-10 sm:h-12 sm:w-12 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-green-700 to-green-500 bg-clip-text text-transparent">
            GreenGuardian
          </h1>
        </div>

        <Card className="shadow-xl shadow-green-900/5 border-green-100/50 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4 sm:pb-6">
            <CardTitle className="text-xl sm:text-2xl font-semibold text-center">
              {sent ? "Check your inbox" : "Forgot your password?"}
            </CardTitle>
            <CardDescription className="text-center text-sm sm:text-base">
              {sent
                ? "We've sent you a link to set a new password."
                : "Enter your email and we'll send you a link to reset it."}
            </CardDescription>
          </CardHeader>

          <CardContent className="pb-6 sm:pb-8">
            {sent ? (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-3 rounded-xl bg-green-50 border border-green-100 p-5 text-center">
                  <CheckCircle2 className="h-10 w-10 text-green-600" />
                  <p className="text-sm text-gray-700 leading-relaxed">
                    If an account exists for{" "}
                    <span className="font-medium text-gray-900">{email}</span>, a reset
                    link is on its way. The link expires in one hour.
                  </p>
                  <p className="text-xs text-gray-500">
                    Don&apos;t see it? Check your spam folder.
                  </p>
                </div>

                {devLink && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 break-all">
                    <p className="font-semibold mb-1">
                      Development mode — no SMTP configured:
                    </p>
                    <a
                      href={devLink}
                      className="underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {devLink}
                    </a>
                  </div>
                )}

                <Button
                  variant="outline"
                  className="w-full h-11"
                  onClick={() => {
                    setSent(false);
                    setDevLink(null);
                  }}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email Address
                  </Label>
                  <div className="relative group">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-focus-within:text-green-500 transition-colors" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      className="pl-10 sm:pl-11 h-11 sm:h-12 text-sm sm:text-base border-gray-200 focus:border-green-500 focus:ring-green-500/20"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 sm:h-12 text-sm sm:text-base font-medium bg-green-600 hover:bg-green-700 shadow-lg shadow-green-600/25"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending link...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-gray-100 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-green-600 hover:text-green-700 hover:underline underline-offset-4"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
