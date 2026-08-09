"use client";

import { useState, useEffect, memo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Shield, 
  Menu, 
  X, 
  LogOut, 
  LayoutDashboard, 
  User,
  ChevronDown,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { signOut } from "@/lib/firebase/auth";

function Navbar() {
  const { user, loading, initialized } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close menus when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const getDashboardLink = () => {
    if (!user) return "/login";
    switch (user.role) {
      case "admin":
        return "/dashboard/admin";
      case "teacher":
        return user.approved ? "/dashboard/teacher" : "/pending-approval";
      case "student":
        return "/dashboard/student";
      default:
        return "/";
    }
  };

  /** True only where `#features` / `#how-it-works` actually exist (app/page.tsx). */
  const onLandingPage = pathname === "/";

  /**
   * `usePathname()` is typed as possibly-null and returns null during the very
   * first render of a statically exported page. The previous
   * `pathname.startsWith(...)` calls would throw there; guarding once here
   * keeps every call site safe.
   */
  const isActive = (href: string, prefix = false) =>
    prefix ? !!pathname?.startsWith(href) : pathname === href;

  /**
   * In-page anchors that still work from other routes.
   *
   * These handlers used to call `preventDefault()` unconditionally and then
   * look the section up by id. On `/profile`, `/login`, or any dashboard page
   * the element does not exist, so the click was swallowed and the link did
   * nothing at all. Off the landing page the href is a real `/#section` URL and
   * the default navigation is allowed through; only the same-page case is
   * intercepted, to keep the smooth scroll.
   */
  const anchorHref = (sectionId: string) => (onLandingPage ? `#${sectionId}` : `/#${sectionId}`);

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    setMobileMenuOpen(false);
    if (!onLandingPage) return; // let Next.js navigate to /#section
    const element = document.getElementById(sectionId);
    if (!element) return; // nothing to scroll to — don't swallow the click
    e.preventDefault();
    element.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100"
          : "bg-white/80 backdrop-blur-sm"
      }`}
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 md:h-18">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="p-1.5 sm:p-2 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg sm:rounded-xl shadow-lg shadow-green-500/20 group-hover:shadow-green-500/40 transition-all duration-300 group-hover:scale-105">
              <Shield className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 text-white" />
            </div>
            <span className="text-base sm:text-lg md:text-xl font-bold bg-gradient-to-r from-green-700 to-emerald-600 bg-clip-text text-transparent">
              GreenGuardian
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-1">
            <NavLink href="/" active={isActive("/")}>Home</NavLink>
            {user ? (
              <>
                <NavLink href={getDashboardLink()} active={isActive("/dashboard", true)}>Dashboard</NavLink>
                {user.role === "student" && (
                  <NavLink href="/exam" active={isActive("/exam", true)}>Available Exams</NavLink>
                )}
                {user.role === "teacher" && (
                  <>
                    <NavLink href="/dashboard/teacher/exams" active={isActive("/dashboard/teacher/exams", true)}>My Exams</NavLink>
                    <NavLink href="/dashboard/teacher/watch-live" active={isActive("/dashboard/teacher/watch-live", true)}>Watch Live</NavLink>
                    <NavLink href="/dashboard/teacher/analytics" active={isActive("/dashboard/teacher/analytics", true)}>Analytics</NavLink>
                  </>
                )}
                {user.role === "admin" && (
                  <>
                    <NavLink href="/dashboard/admin/teachers" active={isActive("/dashboard/admin/teachers", true)}>Teachers</NavLink>
                    <NavLink href="/dashboard/admin/students" active={isActive("/dashboard/admin/students", true)}>Students</NavLink>
                    <NavLink href="/dashboard/admin/health" active={isActive("/dashboard/admin/health", true)}>System Health</NavLink>
                  </>
                )}
              </>
            ) : (
              <>
                <NavLink href={anchorHref("features")} active={false} onClick={(e) => scrollToSection(e, "features")}>Features</NavLink>
                <NavLink href={anchorHref("how-it-works")} active={false} onClick={(e) => scrollToSection(e, "how-it-works")}>How It Works</NavLink>
              </>
            )}
          </nav>

          {/* Desktop Auth Buttons */}
          <div className="hidden md:flex items-center space-x-2 lg:space-x-3">
            {loading || !initialized ? (
              <div className="w-20 h-9 bg-gray-100 animate-pulse rounded-lg" />
            ) : user ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-2 px-2 lg:px-3 py-1.5 lg:py-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  {user.avatarUrl ? (
                    <img 
                      src={user.avatarUrl} 
                      alt={user.name} 
                      className="w-7 h-7 lg:w-8 lg:h-8 rounded-full object-cover border border-emerald-500 shadow-sm" 
                    />
                  ) : (
                    <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs lg:text-sm font-medium shadow-md">
                      {user.name?.charAt(0).toUpperCase() || "U"}
                    </div>
                  )}
                  <span className="text-sm font-medium text-gray-700 max-w-[100px] lg:max-w-[120px] truncate hidden lg:block">
                    {user.name}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50">
                        <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                        <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full capitalize">
                          <Sparkles className="h-3 w-3" />
                          {user.role}
                        </span>
                      </div>
                      <Link
                        href={getDashboardLink()}
                        className="flex items-center space-x-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        <span>Dashboard</span>
                      </Link>
                      <Link
                        href="/profile"
                        className="flex items-center space-x-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <User className="h-4 w-4" />
                        <span>Profile</span>
                      </Link>
                      <hr className="my-2 border-gray-100" />
                      <button
                        onClick={handleLogout}
                        className="flex items-center space-x-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 w-full transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Sign Out</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-900">Sign In</Button>
                </Link>
                <Link href="/register">
                  <Button size="sm" className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-lg shadow-green-600/25 hover:shadow-green-600/40 transition-all duration-300">
                    Get Started
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5 sm:h-6 sm:w-6 text-gray-700" />
            ) : (
              <Menu className="h-5 w-5 sm:h-6 sm:w-6 text-gray-700" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden bg-white border-t border-gray-100 shadow-lg overflow-hidden"
          >
            <div className="container mx-auto px-4 py-4 space-y-3">
              {/* Signed-in users get their own destinations here. The marketing
                  anchors were previously shown to everyone on every route,
                  where they pointed at sections that do not exist. */}
              <nav className="space-y-1">
                <MobileNavLink href="/" onClick={() => setMobileMenuOpen(false)}>Home</MobileNavLink>
                {user ? (
                  <>
                    <MobileNavLink href={getDashboardLink()} onClick={() => setMobileMenuOpen(false)}>
                      Dashboard
                    </MobileNavLink>
                    {user.role === "student" && (
                      <MobileNavLink href="/exam" onClick={() => setMobileMenuOpen(false)}>
                        Available Exams
                      </MobileNavLink>
                    )}
                    {user.role === "teacher" && (
                      <>
                        <MobileNavLink href="/dashboard/teacher/exams" onClick={() => setMobileMenuOpen(false)}>
                          My Exams
                        </MobileNavLink>
                        <MobileNavLink href="/dashboard/teacher/watch-live" onClick={() => setMobileMenuOpen(false)}>
                          Watch Live
                        </MobileNavLink>
                        <MobileNavLink href="/dashboard/teacher/analytics" onClick={() => setMobileMenuOpen(false)}>
                          Analytics
                        </MobileNavLink>
                      </>
                    )}
                    {user.role === "admin" && (
                      <>
                        <MobileNavLink href="/dashboard/admin/students" onClick={() => setMobileMenuOpen(false)}>
                          Students
                        </MobileNavLink>
                        <MobileNavLink href="/dashboard/admin/health" onClick={() => setMobileMenuOpen(false)}>
                          System Health
                        </MobileNavLink>
                      </>
                    )}
                    <MobileNavLink href="/profile" onClick={() => setMobileMenuOpen(false)}>
                      My Profile
                    </MobileNavLink>
                  </>
                ) : (
                  <>
                    <MobileNavLink href={anchorHref("features")} onClick={(e) => scrollToSection(e, "features")}>
                      Features
                    </MobileNavLink>
                    <MobileNavLink href={anchorHref("how-it-works")} onClick={(e) => scrollToSection(e, "how-it-works")}>
                      How It Works
                    </MobileNavLink>
                  </>
                )}
              </nav>

              <hr className="border-gray-200 my-3" />

              {user ? (
                <div className="space-y-3">
                  <div className="flex items-center space-x-3 px-4 py-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-100">
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-lg font-semibold shadow-md">
                      {user.name?.charAt(0).toUpperCase() || "U"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate text-base">{user.name}</p>
                      <p className="text-sm text-gray-500 capitalize flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-green-500" />
                        {user.role}
                      </p>
                    </div>
                  </div>
                  <Link href={getDashboardLink()} onClick={() => setMobileMenuOpen(false)} className="block">
                    <Button className="w-full bg-gradient-to-r from-green-600 to-emerald-600 py-3 text-base" size="lg">
                      <LayoutDashboard className="h-5 w-5 mr-2" />
                      Go to Dashboard
                    </Button>
                  </Link>
                  <Button onClick={handleLogout} variant="ghost" size="lg" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 py-3 text-base">
                    <LogOut className="h-5 w-5 mr-2" />
                    Sign Out
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="block">
                    <Button variant="outline" size="lg" className="w-full py-3 text-base border-2 border-gray-300 hover:border-green-500 hover:text-green-700">Sign In</Button>
                  </Link>
                  <Link href="/register" onClick={() => setMobileMenuOpen(false)} className="block">
                    <Button size="lg" className="w-full py-3 text-base bg-gradient-to-r from-green-600 to-emerald-600 shadow-lg shadow-green-500/25">
                      Get Started Free
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function NavLink({ href, active, children, onClick }: { href: string; active: boolean; children: React.ReactNode; onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`px-3 lg:px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
        active
          ? "text-green-700 bg-green-50"
          : "text-gray-600 hover:text-green-700 hover:bg-green-50/50"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-4 py-3.5 text-base font-medium text-gray-700 hover:bg-green-50 hover:text-green-700 rounded-xl transition-colors active:bg-green-100"
    >
      {children}
    </Link>
  );
}

export default memo(Navbar);
