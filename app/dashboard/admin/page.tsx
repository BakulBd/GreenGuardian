"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, Shield, AlertTriangle, TrendingUp, UserCheck } from "lucide-react";
import { getDashboardStats } from "@/lib/firebase/firestore";
import { DashboardStats } from "@/lib/types";

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await getDashboardStats();
      setStats(data);
    } catch (error) {
      console.error("Error loading stats:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-600 mt-2">Overview of your exam proctoring system</p>
        </div>

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
              value={stats?.totalStudents || 0}
              bgColor="bg-blue-50"
            />
            <StatCard
              icon={<UserCheck className="h-6 w-6 text-green-600" />}
              title="Approved Teachers"
              value={stats?.totalTeachers || 0}
              bgColor="bg-green-50"
            />
            <StatCard
              icon={<AlertTriangle className="h-6 w-6 text-yellow-600" />}
              title="Pending Approvals"
              value={stats?.pendingApprovals || 0}
              bgColor="bg-yellow-50"
            />
            <StatCard
              icon={<FileText className="h-6 w-6 text-purple-600" />}
              title="Total Exams"
              value={stats?.totalExams || 0}
              bgColor="bg-purple-50"
            />
            <StatCard
              icon={<TrendingUp className="h-6 w-6 text-green-600" />}
              title="Active Exams"
              value={stats?.activeExams || 0}
              bgColor="bg-green-50"
            />
            <StatCard
              icon={<Shield className="h-6 w-6 text-red-600" />}
              title="Flagged Sessions"
              value={stats?.flaggedSessions || 0}
              bgColor="bg-red-50"
            />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest system events</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">No recent activity</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common administrative tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <a
                  href="/dashboard/admin/teachers"
                  className="block p-3 rounded-lg hover:bg-gray-50 border transition-colors"
                >
                  <p className="font-medium text-sm">Review Teacher Applications</p>
                  <p className="text-xs text-gray-600">
                    {stats?.pendingApprovals || 0} pending
                  </p>
                </a>
                <a
                  href="/dashboard/admin/exams"
                  className="block p-3 rounded-lg hover:bg-gray-50 border transition-colors"
                >
                  <p className="font-medium text-sm">Manage Exams</p>
                  <p className="text-xs text-gray-600">
                    {stats?.totalExams || 0} total exams
                  </p>
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  icon,
  title,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  bgColor: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-3xl font-bold text-gray-900 mt-2">{value}</p>
          </div>
          <div className={`p-3 rounded-lg ${bgColor}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
