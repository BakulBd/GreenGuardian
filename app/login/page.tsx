"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { loginUser } from "@/lib/firebase/auth";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user, loading: authLoading, initialized } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  /**
   * Where to send someone after a successful sign-in.
   *
   * Guarded pages redirect here with `?next=`, so a student who opened an exam
   * link while logged out lands on that exam rather than the dashboard. Only
   * same-site paths are honoured — accepting an absolute URL here would turn
   * the login page into an open redirect.
   */
  const destinationFor = useCallback(
    (role: string, approved?: boolean) => {
      const next = searchParams?.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) return next;

      if (role === "admin") return "/dashboard/admin";
      if (role === "teacher") return approved ? "/dashboard/teacher" : "/pending-approval";
      return "/dashboard/student";
    },
    [searchParams]
  );

  useEffect(() => {
    if (initialized && !authLoading && user) {
      router.replace(destinationFor(user.role, user.approved));
    }
  }, [user, authLoading, initialized, router, destinationFor]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.email || !formData.password) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { user, error } = await loginUser(formData.email, formData.password);
      
      if (error || !user) {
        throw new Error(error || "Invalid credentials");
      }

      toast({
        title: "Login Successful",
        description: `Welcome back, ${user.name}!`,
      });

      // Honour ?next= when present, otherwise land on the role's dashboard.
      // A teacher awaiting approval always goes to the holding page.
      router.push(
        user.role === "teacher" && !user.approved
          ? "/pending-approval"
          : destinationFor(user.role, user.approved)
      );
    } catch (error: any) {
      let message = error?.message || "Something went wrong";
      toast({
        title: "Login Error",
        description: message +
          " Please check your credentials and internet connection. If the problem persists, try again later or contact support.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-green-50 via-white to-green-100 flex items-center justify-center p-4 sm:p-6 md:p-8">
      {/* Background decoration */}
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
        {/* Logo and Title */}
        <motion.div 
          className="text-center mb-6 sm:mb-8"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <div className="flex justify-center mb-3 sm:mb-4">
            <div className="relative">
              <div className="absolute inset-0 bg-green-400/20 rounded-full blur-xl scale-150" />
              <Shield className="relative h-10 w-10 sm:h-12 sm:w-12 md:h-14 md:w-14 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-green-700 to-green-500 bg-clip-text text-transparent">
            GreenGuardian
          </h1>
          <p className="text-gray-500 mt-1.5 sm:mt-2 text-sm sm:text-base">
            Secure Exam Proctoring System
          </p>
        </motion.div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          <Card className="shadow-xl shadow-green-900/5 border-green-100/50 backdrop-blur-sm">
            <CardHeader className="space-y-1 pb-4 sm:pb-6">
              <CardTitle className="text-xl sm:text-2xl font-semibold text-center">
                Welcome Back
              </CardTitle>
              <CardDescription className="text-center text-sm sm:text-base">
                Enter your credentials to access your account
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-6 sm:pb-8">
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                {/* Email Field */}
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
                      className="pl-10 sm:pl-11 h-11 sm:h-12 text-sm sm:text-base transition-all border-gray-200 focus:border-green-500 focus:ring-green-500/20"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Password
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400 group-focus-within:text-green-500 transition-colors" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pl-10 sm:pl-11 pr-10 sm:pr-11 h-11 sm:h-12 text-sm sm:text-base transition-all border-gray-200 focus:border-green-500 focus:ring-green-500/20"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      autoComplete="current-password"
                      required
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-green-500 transition-colors"
                      tabIndex={-1}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />
                      ) : (
                        <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Submit Button */}
                <Button 
                  type="submit" 
                  className="w-full h-11 sm:h-12 text-sm sm:text-base font-medium bg-green-600 hover:bg-green-700 active:bg-green-800 transition-all shadow-lg shadow-green-600/25 hover:shadow-green-600/40"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>

              {/* Register Link */}
              <div className="mt-6 pt-4 sm:pt-6 border-t border-gray-100 text-center">
                <p className="text-sm sm:text-base text-gray-600">
                  Don&apos;t have an account?{" "}
                  <Link 
                    href="/register" 
                    className="font-medium text-green-600 hover:text-green-700 hover:underline underline-offset-4 transition-colors"
                  >
                    Create Account
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Footer */}
        <motion.p 
          className="text-center text-xs sm:text-sm text-gray-400 mt-6 sm:mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          Secure • Reliable • Fair Exams
        </motion.p>
      </motion.div>
    </div>
  );
}
