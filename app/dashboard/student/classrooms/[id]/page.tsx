"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getClassroom, isClassroomMember } from "@/lib/firebase/classrooms";
import { Classroom } from "@/lib/types";
import ClassroomDetailShell from "@/components/classroom/ClassroomDetailShell";

export default function StudentClassroomDetailPage() {
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
        const [data, member] = await Promise.all([getClassroom(classroomId), isClassroomMember(classroomId, user.id)]);
        if (!data || !member) {
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
      <DashboardLayout role="student">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (denied || !classroom || !user) {
    return (
      <DashboardLayout role="student">
        <Card>
          <CardContent className="text-center py-16">
            <ShieldAlert className="mx-auto h-14 w-14 text-red-400 mb-4" />
            <h2 className="text-xl font-semibold text-gray-700">Not Available</h2>
            <p className="text-gray-500 mt-2">You haven&apos;t joined this classroom, or it doesn&apos;t exist.</p>
            <Button className="mt-4" onClick={() => router.push("/dashboard/student/classrooms")}>
              Back to My Classrooms
            </Button>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="student">
      <ClassroomDetailShell classroom={classroom} isTeacher={false} currentUser={user} backHref="/dashboard/student/classrooms" />
    </DashboardLayout>
  );
}
