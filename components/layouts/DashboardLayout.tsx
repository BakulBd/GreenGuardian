"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Users,
  FileText,
  Settings,
  LogOut,
  Shield,
  UserCheck,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/firebase/auth";

interface DashboardLayoutProps {
  children: ReactNode;
  role: "admin" | "teacher" | "student";
}

export default function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const { user, loading, initialized } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Only check auth after fully initialized and not loading
    if (initialized && !loading && !authChecked) {
      setAuthChecked(true);
      
      if (!user) {
        router.replace("/login");
      } else if (role === "admin" && user.role !== "admin") {
        router.replace("/login");
      } else if (role === "teacher" && user.role !== "teacher") {
        router.replace("/login");
      } else if (role === "teacher" && !user.approved) {
        router.replace("/pending-approval");
      } else if (role === "student" && user.role !== "student") {
        router.replace("/login");
      }
    }
  }, [initialized, loading, user, role, router, authChecked]);

  // Show loading state while auth is initializing
  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
        <p className="text-gray-600">Loading dashboard...</p>
      </div>
    );
  }

  // Don't render if user is not authorized
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
        <p className="text-gray-600">Redirecting to login...</p>
      </div>
    );
  }

  // Wrong role check
  if ((role === "admin" && user.role !== "admin") || 
      (role === "teacher" && user.role !== "teacher") ||
      (role === "student" && user.role !== "student")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
        <p className="text-gray-600">Access denied. Redirecting...</p>
      </div>
    );
  }

  // Teacher not approved
  if (role === "teacher" && !user.approved) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
        <p className="text-gray-600">Pending approval. Redirecting...</p>
      </div>
    );
  }

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const adminMenuItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard/admin" },
    { icon: UserCheck, label: "Teachers", href: "/dashboard/admin/teachers" },
    { icon: Users, label: "Students", href: "/dashboard/admin/students" },
    { icon: FileText, label: "Exams", href: "/dashboard/admin/exams" },
    { icon: Settings, label: "Settings", href: "/dashboard/admin/settings" },
  ];

  const teacherMenuItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard/teacher" },
    { icon: FileText, label: "My Exams", href: "/dashboard/teacher/exams" },
    { icon: Users, label: "Students", href: "/dashboard/teacher/students" },
    { icon: Shield, label: "Monitoring", href: "/dashboard/teacher/monitoring" },
  ];

  const studentMenuItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard/student" },
    { icon: FileText, label: "Available Exams", href: "/exam" },
  ];

  const menuItems = role === "admin" ? adminMenuItems : role === "teacher" ? teacherMenuItems : studentMenuItems;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r transform transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <div className="flex items-center space-x-2">
              <Shield className="h-6 w-6 text-primary-600" />
              <span className="text-xl font-bold">GreenGuardian</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* User Info */}
          <div className="px-6 py-4 border-b bg-gray-50">
            <p className="text-sm font-medium text-gray-900">{user.name}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
            <p className="text-xs text-primary-600 mt-1 capitalize">{user.role}</p>
          </div>

          {/* Menu Items */}
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto" aria-label="Dashboard navigation">
            {menuItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <motion.div
                  whileHover={{ x: 4 }}
                  className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors"
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{item.label}</span>
                </motion.div>
              </Link>
            ))}
          </nav>

          {/* Logout */}
          <div className="px-4 py-4 border-t">
            <Button
              variant="ghost"
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={handleLogout}
            >
              <LogOut className="h-5 w-5 mr-3" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`transition-all duration-200 ${sidebarOpen ? "lg:pl-64" : "pl-0"}`}>
        {/* Top Bar */}
        <header className="bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-gray-100"
              aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome back, {user.name}!</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="p-6">{children}</main>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
