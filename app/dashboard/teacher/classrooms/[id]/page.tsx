"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getClassroom } from "@/lib/firebase/classrooms";
import { Classroom } from "@/lib/types";
import ClassroomDetailShell from "@/components/classroom/ClassroomDetailShell";

export default function TeacherClassroomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const classroomId = params.id as string;

  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const data = await getClassroom(classroomId);
        if (!data) {
          setClassroom(null);
        } else if (data.teacherId !== user.id) {
          setDenied(true);
        } else {
          setClassroom(data);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [classroomId, user]);

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (denied) {
    return (
      <DashboardLayout role="teacher">
        <Card>
          <CardContent className="text-center py-16">
            <ShieldAlert className="mx-auto h-14 w-14 text-red-400 mb-4" />
            <h2 className="text-xl font-semibold text-gray-700">Access Denied</h2>
            <p className="text-gray-500 mt-2">You can only manage classrooms you created.</p>
            <Button className="mt-4" onClick={() => router.push("/dashboard/teacher/classrooms")}>
              Back to Classrooms
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  if (!classroom || !user) {
    return (
      <DashboardLayout role="teacher">
        <Card>
          <CardContent className="text-center py-16">
            <h2 className="text-xl font-semibold text-gray-700">Classroom Not Found</h2>
            <Button className="mt-4" onClick={() => router.push("/dashboard/teacher/classrooms")}>
              Back to Classrooms
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <ClassroomDetailShell classroom={classroom} isTeacher currentUser={user} backHref="/dashboard/teacher/classrooms" />
    </DashboardLayout>
  );
}
