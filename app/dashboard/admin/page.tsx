"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  FileText,
  Shield,
  AlertTriangle,
  TrendingUp,
  UserCheck,
  AlertCircle,
  RefreshCw,
  Camera,
  GraduationCap,
  UserCog,
  Activity,
} from "lucide-react";
import { getDashboardStats } from "@/lib/firebase/firestore";
import { DashboardStats, DashboardActivityItem } from "@/lib/types";

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const ACTIVITY_ICONS: Record<DashboardActivityItem["kind"], typeof Users> = {
  user: Users,
  exam: FileText,
  session: Activity,
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setError(null);
    setRefreshing(true);
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch (err) {
      console.error("Error loading stats:", err);
      setError("Could not load dashboard statistics. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-2">Overview of your exam proctoring system</p>
          </div>
          <Button variant="outline" onClick={loadStats} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadStats}>
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </CardHeader>
                <CardContent>
                  <div className="h-8 bg-gray-200 rounded w-1/4"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <StatCard
              icon={<Users className="h-6 w-6 text-blue-600" />}
              title="Total Students"
              value={stats?.totalStudents ?? 0}
              bgColor="bg-blue-50"
              href="/dashboard/admin/students"
            />
            <StatCard
              icon={<UserCheck className="h-6 w-6 text-green-600" />}
              title="Approved Teachers"
              value={stats?.totalTeachers ?? 0}
              bgColor="bg-green-50"
              href="/dashboard/admin/teachers"
            />
            <StatCard
              icon={<AlertTriangle className="h-6 w-6 text-yellow-600" />}
              title="Pending Approvals"
              value={stats?.pendingApprovals ?? 0}
              bgColor="bg-yellow-50"
              href="/dashboard/admin/teachers"
            />
            <StatCard
              icon={<FileText className="h-6 w-6 text-purple-600" />}
              title="Total Exams"
              value={stats?.totalExams ?? 0}
              subtitle={`${stats?.publishedExams ?? 0} published or active`}
              bgColor="bg-purple-50"
              href="/dashboard/admin/exams"
            />
            <StatCard
              icon={<Camera className="h-6 w-6 text-emerald-600" />}
              title="Live Sessions Now"
              value={stats?.liveSessions ?? 0}
              subtitle={`${stats?.submittedSessions ?? 0} submitted all-time`}
              bgColor="bg-emerald-50"
            />
            <StatCard
              icon={<Shield className="h-6 w-6 text-red-600" />}
              title="Flagged Sessions"
              value={stats?.flaggedSessions ?? 0}
              subtitle={
                (stats?.suspendedAccounts ?? 0) > 0
                  ? `${stats?.suspendedAccounts} account(s) on hold or suspended`
                  : undefined
              }
              bgColor="bg-red-50"
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>
                Newest registrations, exams and exam attempts
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                  ))}
                </div>
              ) : !stats?.recentActivity?.length ? (
                <div className="py-8 text-center">
                  <Activity className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    Nothing has happened yet. Registrations, exams and attempts appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y">
                  {stats.recentActivity.map((item) => {
                    const Icon = ACTIVITY_ICONS[item.kind];
                    return (
                      <li key={item.id} className="flex items-start gap-3 py-2.5">
                        <span className="mt-0.5 p-1.5 rounded-lg bg-gray-100 text-gray-600 flex-shrink-0">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900">{item.message}</p>
                          {item.detail && (
                            <p className="text-xs text-gray-500">{item.detail}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {timeAgo(item.at)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common administrative tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <QuickAction
                  href="/dashboard/admin/teachers"
                  icon={<UserCheck className="h-4 w-4" />}
                  title="Review Teacher Applications"
                  subtitle={`${stats?.pendingApprovals ?? 0} pending`}
                  highlight={(stats?.pendingApprovals ?? 0) > 0}
                />
                <QuickAction
                  href="/dashboard/admin/assignments"
                  icon={<UserCog className="h-4 w-4" />}
                  title="Course Assignments"
                  subtitle="Link teachers to a course, batch and section"
                />
                <QuickAction
                  href="/dashboard/admin/courses"
                  icon={<GraduationCap className="h-4 w-4" />}
                  title="Courses, Batches & Sections"
                  subtitle="Maintain the academic catalog"
                />
                <QuickAction
                  href="/dashboard/admin/exams"
                  icon={<FileText className="h-4 w-4" />}
                  title="Manage Exams"
                  subtitle={`${stats?.totalExams ?? 0} total exams`}
                />
                <QuickAction
                  href="/dashboard/admin/students"
                  icon={<Users className="h-4 w-4" />}
                  title="Manage Students"
                  subtitle={`${stats?.totalStudents ?? 0} enrolled`}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function QuickAction({
  href,
  icon,
  title,
  subtitle,
  highlight,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-gray-50 ${
        highlight ? "border-yellow-300 bg-yellow-50/60" : ""
      }`}
    >
      <span className="p-2 rounded-lg bg-white border text-gray-600">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium text-sm text-gray-900">{title}</span>
        <span className="block text-xs text-gray-600">{subtitle}</span>
      </span>
    </Link>
  );
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  bgColor,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  subtitle?: string;
  bgColor: string;
  href?: string;
}) {
  const body = (
    <Card className={href ? "hover:shadow-md transition-shadow" : undefined}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
            {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          </div>
          <div className={`p-3 rounded-lg flex-shrink-0 ${bgColor}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
