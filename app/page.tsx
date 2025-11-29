"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { 
  Shield, 
  Users, 
  FileText, 
  Eye, 
  Lock, 
  Zap, 
  CheckCircle2,
  ArrowRight,
  Monitor,
  Brain,
  BarChart3,
  Globe,
  Star,
  Sparkles,
  GraduationCap,
  Camera,
  AlertTriangle,
  Smartphone,
  Award,
  Clock,
  BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";

export default function HomePage() {
  const router = useRouter();
  const { user, loading, initialized } = useAuth();

  useEffect(() => {
    if (initialized && !loading && user) {
      switch (user.role) {
        case "admin":
          router.replace("/dashboard/admin");
          break;
        case "teacher":
          router.replace(user.approved ? "/dashboard/teacher" : "/pending-approval");
          break;
        case "student":
          router.replace("/exam");
          break;
      }
    }
  }, [user, loading, initialized, router]);

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <div className="text-center">
          <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm sm:text-base">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <div className="text-center">
          <div className="w-12 h-12 sm:w-16 sm:h-16 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm sm:text-base">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50 overflow-x-hidden">
      <Navbar />

      {/* Hero Section */}
      <section className="pt-16 sm:pt-20 md:pt-28 pb-10 sm:pb-14 md:pb-20 relative overflow-hidden">
        {/* Simplified background decorations - CSS only for performance */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-20 -right-20 w-64 sm:w-80 md:w-96 h-64 sm:h-80 md:h-96 bg-gradient-to-br from-green-300/30 to-emerald-300/30 rounded-full blur-3xl animate-pulse" />
          <div className="absolute -bottom-20 -left-20 w-72 sm:w-96 md:w-[450px] h-72 sm:h-96 md:h-[450px] bg-gradient-to-tr from-emerald-300/20 to-teal-300/20 rounded-full blur-3xl" />
        </div>

        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center max-w-5xl mx-auto"
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-green-100 to-emerald-100 rounded-full text-green-700 text-xs sm:text-sm font-medium mb-5 sm:mb-6 border border-green-200/50 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span>AI-Powered Exam Security Platform</span>
            </div>

            {/* Main Heading */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-4 sm:mb-5 leading-tight tracking-tight">
              Secure Your Exams with{" "}
              <span className="bg-gradient-to-r from-green-600 via-emerald-500 to-teal-500 bg-clip-text text-transparent">
                Intelligent AI
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-sm sm:text-base md:text-lg lg:text-xl text-gray-600 mb-6 sm:mb-8 max-w-2xl lg:max-w-3xl mx-auto leading-relaxed px-2">
              Advanced proctoring with real-time face detection, mobile phone detection, 
              gaze tracking, and comprehensive behavior analysis.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 px-4">
              <Link href="/register" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto text-sm sm:text-base px-5 sm:px-7 py-4 sm:py-5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-lg shadow-green-600/20 transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5">
                  <GraduationCap className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Link href="/login" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-sm sm:text-base px-5 sm:px-7 py-4 sm:py-5 border-2 hover:bg-gray-50 transition-all duration-300">
                  Sign In
                </Button>
              </Link>
            </div>

            {/* Trust Badges */}
            <div className="mt-6 sm:mt-8 flex flex-wrap justify-center gap-3 sm:gap-6 text-xs sm:text-sm text-gray-500 px-2">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>Free for Students</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>No Installation</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>All Devices</span>
              </div>
            </div>
          </motion.div>

          {/* Stats Grid */}
          <div className="mt-10 sm:mt-14 md:mt-16 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 max-w-3xl mx-auto px-4">
            <StatCard number="50K+" label="Exams Proctored" icon={<BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600" />} />
            <StatCard number="99.9%" label="Accuracy" icon={<Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600" />} />
            <StatCard number="500+" label="Institutions" icon={<GraduationCap className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-purple-600" />} />
            <StatCard number="4.9" label="Rating" icon={<Star className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-500 fill-yellow-500" />} />
          </div>
        </div>
      </section>

      {/* AI Detection Features - Visual Section */}
      <section className="py-12 sm:py-16 md:py-20 bg-white relative">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-10 sm:mb-12 md:mb-16"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 rounded-full text-blue-700 text-xs font-medium mb-4">
              <Brain className="h-3.5 w-3.5" />
              <span>AI-Powered Detection</span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-3 sm:mb-4">
              Advanced Proctoring Technology
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-gray-600 max-w-2xl mx-auto">
              Real-time AI monitoring ensures exam integrity with minimal false positives
            </p>
          </motion.div>

          {/* Detection Cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <DetectionCard
              icon={<Camera className="h-6 w-6" />}
              title="Face Detection"
              description="Continuous monitoring with BlazeFace ML model"
              color="green"
              stats="Real-time"
            />
            <DetectionCard
              icon={<Smartphone className="h-6 w-6" />}
              title="Mobile Phone Detection"
              description="COCO-SSD model detects phones and devices"
              color="red"
              stats="High Priority"
            />
            <DetectionCard
              icon={<Eye className="h-6 w-6" />}
              title="Gaze Tracking"
              description="Detects when students look away from screen"
              color="blue"
              stats="Precise"
            />
            <DetectionCard
              icon={<Users className="h-6 w-6" />}
              title="Person Detection"
              description="Alerts when multiple faces appear"
              color="orange"
              stats="Critical"
            />
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 sm:py-16 md:py-24 bg-gradient-to-br from-gray-50 to-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center mb-10 sm:mb-12 md:mb-16"
          >
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-3 sm:mb-4">
              Complete Exam Security Suite
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-gray-600 max-w-2xl mx-auto">
              Everything you need for secure, fair online examinations
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
            <FeatureCard
              icon={<Camera className="h-5 w-5 sm:h-6 sm:w-6" />}
              title="Live Camera Monitoring"
              description="Real-time webcam feed with AI-powered face and object detection"
              color="green"
            />
            <FeatureCard
              icon={<AlertTriangle className="h-5 w-5 sm:h-6 sm:w-6" />}
              title="Smart Warning System"
              description="Intelligent alerts with cooldowns to prevent false positives"
              color="orange"
            />
            <FeatureCard
              icon={<BarChart3 className="h-5 w-5 sm:h-6 sm:w-6" />}
              title="Behavior Score"
              description="Comprehensive scoring system with diminishing returns for fair assessment"
              color="blue"
            />
            <FeatureCard
              icon={<Monitor className="h-5 w-5 sm:h-6 sm:w-6" />}
              title="Tab & Window Detection"
              description="Automatic detection when students switch tabs or minimize window"
              color="purple"
            />
            <FeatureCard
              icon={<Lock className="h-5 w-5 sm:h-6 sm:w-6" />}
              title="Fullscreen Enforcement"
              description="Secure fullscreen mode with exit detection and logging"
              color="red"
            />
            <FeatureCard
              icon={<FileText className="h-5 w-5 sm:h-6 sm:w-6" />}
              title="Plagiarism Detection"
              description="OCR-powered content analysis using Gemini AI"
              color="teal"
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-10 sm:py-14 md:py-20 bg-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-10 md:mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-100 rounded-full text-green-700 text-xs font-medium mb-3 sm:mb-4">
              <Zap className="h-3.5 w-3.5" />
              <span>Quick Setup</span>
            </div>
            <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">
              Get Started in Minutes
            </h2>
            <p className="text-sm sm:text-base text-gray-600 max-w-xl mx-auto">
              Simple setup, powerful protection
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 max-w-4xl mx-auto">
            <StepCard
              step="1"
              title="Create Account"
              description="Register as student, teacher, or admin"
              icon={<Users className="h-4 w-4 sm:h-5 sm:w-5" />}
            />
            <StepCard
              step="2"
              title="Setup Exam"
              description="Create questions and configure rules"
              icon={<FileText className="h-4 w-4 sm:h-5 sm:w-5" />}
            />
            <StepCard
              step="3"
              title="Monitor Live"
              description="View real-time alerts and reports"
              icon={<Eye className="h-4 w-4 sm:h-5 sm:w-5" />}
            />
          </div>
        </div>
      </section>

      {/* User Roles */}
      <section className="py-10 sm:py-14 md:py-20 bg-gradient-to-br from-gray-50 to-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-10 md:mb-14">
            <h2 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 sm:mb-3">
              Designed for Everyone
            </h2>
            <p className="text-sm sm:text-base text-gray-600 max-w-xl mx-auto">
              Dedicated dashboards for each user role
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-5">
            <RoleCard
              icon={<GraduationCap className="h-6 w-6 sm:h-7 sm:w-7" />}
              title="Students"
              features={[
                "Easy exam access",
                "Camera setup guide",
                "Real-time feedback",
                "Instant submission"
              ]}
              color="green"
            />
            <RoleCard
              icon={<BookOpen className="h-6 w-6 sm:h-7 sm:w-7" />}
              title="Teachers"
              features={[
                "Create & manage exams",
                "Live monitoring",
                "AI answer evaluation",
                "Behavior reports"
              ]}
              color="blue"
            />
            <RoleCard
              icon={<Shield className="h-6 w-6 sm:h-7 sm:w-7" />}
              title="Administrators"
              features={[
                "Manage all users",
                "Approve teacher accounts",
                "System-wide analytics",
                "Full platform control"
              ]}
              color="purple"
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 sm:py-16 md:py-24 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-full h-full" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="absolute top-10 right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl hidden md:block"
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="absolute bottom-10 left-10 w-40 h-40 bg-white/10 rounded-full blur-2xl hidden md:block"
        />
        
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/20 rounded-full text-white text-xs sm:text-sm font-medium mb-6 backdrop-blur-sm">
              <Award className="h-4 w-4" />
              <span>Join 500+ Educational Institutions</span>
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4 sm:mb-6">
              Ready to Secure Your Exams?
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-green-100 mb-6 sm:mb-8 max-w-2xl mx-auto">
              Join thousands of educators and students using GreenGuardian for 
              secure, fair, and efficient online examinations.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4">
              <Link href="/register" className="w-full sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto bg-white text-green-700 hover:bg-gray-100 text-sm sm:text-base px-6 sm:px-8 py-5 sm:py-6 shadow-xl transition-all hover:shadow-2xl hover:-translate-y-0.5">
                  <GraduationCap className="mr-2 h-5 w-5" />
                  Create Free Account
                </Button>
              </Link>
              <Link href="/login" className="w-full sm:w-auto">
                <button className="w-full sm:w-auto inline-flex items-center justify-center font-medium rounded-lg border-2 border-white text-white bg-white/10 hover:bg-white/20 text-sm sm:text-base px-6 sm:px-8 py-3 sm:py-4 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5">
                  Sign In
                  <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5" />
                </button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-10 sm:py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="sm:col-span-2 md:col-span-2">
              <div className="flex items-center space-x-2 mb-4">
                <div className="p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <span className="text-lg sm:text-xl font-bold text-white">GreenGuardian</span>
              </div>
              <p className="text-xs sm:text-sm max-w-md leading-relaxed">
                AI-powered online exam proctoring platform ensuring academic integrity 
                with advanced face detection, mobile device detection, gaze tracking, and behavior analysis.
              </p>
              <div className="flex items-center gap-2 mt-4 text-xs sm:text-sm">
                <Clock className="h-4 w-4 text-green-500" />
                <span>24/7 Automated Monitoring</span>
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm sm:text-base">Platform</h4>
              <ul className="space-y-2 text-xs sm:text-sm">
                <li><Link href="#features" className="hover:text-white transition-colors">Features</Link></li>
                <li><Link href="/register" className="hover:text-white transition-colors">Get Started</Link></li>
                <li><Link href="/login" className="hover:text-white transition-colors">Sign In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4 text-sm sm:text-base">Resources</h4>
              <ul className="space-y-2 text-xs sm:text-sm">
                <li><span className="text-gray-500">Documentation</span></li>
                <li><span className="text-gray-500">Help Center</span></li>
                <li><span className="text-gray-500">Privacy Policy</span></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 sm:pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs sm:text-sm text-center md:text-left">&copy; 2025 GreenGuardian. All rights reserved.</p>
            <div className="flex items-center space-x-2 text-xs sm:text-sm">
              <Globe className="h-4 w-4" />
              <span>Made with ❤️ for Education</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Enhanced Components
function StatCard({ number, label, icon }: { number: string; label: string; icon?: React.ReactNode }) {
  return (
    <motion.div 
      whileHover={{ y: -5, scale: 1.02 }}
      className="bg-white rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg border border-gray-100 text-center transition-all hover:shadow-xl"
    >
      <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-1">
        {icon}
        <span className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">{number}</span>
      </div>
      <p className="text-[10px] sm:text-xs md:text-sm text-gray-500">{label}</p>
    </motion.div>
  );
}

function DetectionCard({ icon, title, description, color, stats }: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
  color: string;
  stats: string;
}) {
  const colorClasses: Record<string, { bg: string; text: string; badge: string }> = {
    green: { bg: "bg-green-100", text: "text-green-600", badge: "bg-green-600" },
    red: { bg: "bg-red-100", text: "text-red-600", badge: "bg-red-600" },
    blue: { bg: "bg-blue-100", text: "text-blue-600", badge: "bg-blue-600" },
    orange: { bg: "bg-orange-100", text: "text-orange-600", badge: "bg-orange-600" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -5 }}
      className="bg-gradient-to-br from-white to-gray-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all relative overflow-hidden group"
    >
      <div className={`absolute top-0 right-0 px-2 sm:px-3 py-1 ${colorClasses[color].badge} text-white text-[10px] sm:text-xs font-medium rounded-bl-lg`}>
        {stats}
      </div>
      <div className={`inline-flex p-2.5 sm:p-3 rounded-xl mb-3 sm:mb-4 ${colorClasses[color].bg} ${colorClasses[color].text} transition-transform group-hover:scale-110`}>
        {icon}
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-1.5 sm:mb-2">{title}</h3>
      <p className="text-gray-600 text-xs sm:text-sm leading-relaxed">{description}</p>
    </motion.div>
  );
}

function FeatureCard({ icon, title, description, color }: { 
  icon: React.ReactNode; 
  title: string; 
  description: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    green: "bg-green-100 text-green-600",
    blue: "bg-blue-100 text-blue-600",
    purple: "bg-purple-100 text-purple-600",
    orange: "bg-orange-100 text-orange-600",
    red: "bg-red-100 text-red-600",
    teal: "bg-teal-100 text-teal-600",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -5 }}
      className="bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg border border-gray-100 hover:shadow-xl transition-all group"
    >
      <div className={`inline-flex p-2.5 sm:p-3 rounded-xl mb-3 sm:mb-4 ${colorClasses[color]} transition-transform group-hover:scale-110`}>
        {icon}
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-1.5 sm:mb-2">{title}</h3>
      <p className="text-gray-600 text-xs sm:text-sm leading-relaxed">{description}</p>
    </motion.div>
  );
}

function StepCard({ step, title, description, icon }: { step: string; title: string; description: string; icon: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="text-center relative"
    >
      <div className="relative inline-block mb-4 sm:mb-6">
        <div className="w-14 h-14 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-white text-xl sm:text-2xl md:text-3xl font-bold flex items-center justify-center mx-auto shadow-lg shadow-green-500/30">
          {step}
        </div>
        <div className="absolute -bottom-1 -right-1 p-1.5 sm:p-2 bg-white rounded-full shadow-md">
          <div className="p-1 sm:p-1.5 bg-green-100 rounded-full text-green-600">
            {icon}
          </div>
        </div>
      </div>
      <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-1.5 sm:mb-2">{title}</h3>
      <p className="text-gray-600 text-xs sm:text-sm max-w-xs mx-auto">{description}</p>
    </motion.div>
  );
}

function RoleCard({ icon, title, features, color }: { 
  icon: React.ReactNode; 
  title: string; 
  features: string[];
  color: string;
}) {
  const colorClasses: Record<string, { bg: string; icon: string; border: string; check: string }> = {
    green: { bg: "bg-gradient-to-br from-green-50 to-emerald-50", icon: "text-green-600", border: "border-green-200", check: "text-green-600" },
    blue: { bg: "bg-gradient-to-br from-blue-50 to-indigo-50", icon: "text-blue-600", border: "border-blue-200", check: "text-blue-600" },
    purple: { bg: "bg-gradient-to-br from-purple-50 to-violet-50", icon: "text-purple-600", border: "border-purple-200", check: "text-purple-600" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -5 }}
      className={`rounded-xl sm:rounded-2xl p-4 sm:p-6 border-2 ${colorClasses[color].bg} ${colorClasses[color].border} transition-all hover:shadow-lg`}
    >
      <div className={`mb-3 sm:mb-4 ${colorClasses[color].icon}`}>{icon}</div>
      <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-3 sm:mb-4">{title}</h3>
      <ul className="space-y-2 sm:space-y-3">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-gray-700">
            <CheckCircle2 className={`h-4 w-4 sm:h-5 sm:w-5 ${colorClasses[color].check} flex-shrink-0 mt-0.5`} />
            <span className="text-xs sm:text-sm">{feature}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
