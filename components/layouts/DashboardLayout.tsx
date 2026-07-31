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
  User,
  Menu,
  X,
  Loader2,
  Camera,
  BookOpen,
  Award,
  Bell,
  Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { signOut } from "@/lib/firebase/auth";
import { auth } from "@/lib/firebase/config";
import { subscribeToUnreadCount } from "@/lib/firebase/notices";

interface DashboardLayoutProps {
  children: ReactNode;
  role: "admin" | "teacher" | "student";
}

export default function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const { user, loading: authLoading, initialized } = useAuth();
  const [loading, setLoading] = useState(!initialized || authLoading);
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    if (initialized && !authLoading) {
      setLoading(false);
    }
  }, [initialized, authLoading]);

// Subscribe to notification count for students
  useEffect(() => {
    if (user && user.role === "student") {
      const unsub = subscribeToUnreadCount(user.id, (count) => {
        setNotificationCount(count);
      });
      return () => unsub();
    }
  }, [user]);

  useEffect(() => {
    // Only check auth after fully initialized and not loading
    if (initialized && !authLoading) {
      if (!user && auth.currentUser) {
        // Firebase Auth is active, user profile sync in progress
        return;
      }

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
  }, [initialized, loading, user, role, router]);

  // Show loading state while auth is initializing or user profile is syncing
  if (!initialized || loading || (!user && auth.currentUser)) {
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
    { icon: BookOpen, label: "Academics", href: "/dashboard/admin/academics" },
    { icon: UserCheck, label: "Teachers", href: "/dashboard/admin/teachers" },
    { icon: Users, label: "Students", href: "/dashboard/admin/students" },
    { icon: FileText, label: "Exams", href: "/dashboard/admin/exams" },
    { icon: Settings, label: "Settings", href: "/dashboard/admin/settings" },
    { icon: User, label: "My Profile", href: "/profile" },
  ];

const teacherMenuItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard/teacher" },
    { icon: BookOpen, label: "My Courses", href: "/dashboard/teacher/courses" },
    { icon: FileText, label: "My Exams", href: "/dashboard/teacher/exams" },
    { icon: Megaphone, label: "Notices", href: "/dashboard/teacher/notices" },
    { icon: FileText, label: "Submissions & OCR", href: "/dashboard/teacher/answers" },
    { icon: Camera, label: "Watch Live", href: "/dashboard/teacher/watch-live" },
    { icon: Shield, label: "Live Monitoring", href: "/dashboard/teacher/monitoring" },
    { icon: Users, label: "Students", href: "/dashboard/teacher/students" },
    { icon: User, label: "My Profile", href: "/profile" },
  ];

  const studentMenuItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard/student" },
    { icon: FileText, label: "Available Exams", href: "/exam" },
    { icon: Award, label: "My Results", href: "/dashboard/student/results" },
    { icon: Megaphone, label: "Notices", href: "/dashboard/student/notices" },
    { icon: User, label: "My Profile", href: "/profile" },
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
                  className="flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-primary-50 text-gray-700 hover:text-primary-700 transition-colors relative"
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-sm font-medium">{item.label}</span>
                  {item.label === "Notices" && role === "student" && notificationCount > 0 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
                      {notificationCount > 99 ? "99+" : notificationCount}
                    </span>
                  )}
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
              <span className="text-sm text-gray-600 hidden sm:inline">Welcome back, {user.name}!</span>
              {role === "student" && (
                <Link href="/dashboard/student/notices">
                  <Button variant="ghost" size="sm" className="relative">
                    <Bell className="h-5 w-5" />
                    {notificationCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                        {notificationCount > 9 ? "9+" : notificationCount}
                      </span>
                    )}
                  </Button>
                </Link>
              )}
              <Link href="/profile">
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-5 h-5 rounded-full object-cover border border-emerald-500" />
                  ) : (
                    <UserCheck className="h-4 w-4" />
                  )}
                  Profile
                </Button>
              </Link>
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
