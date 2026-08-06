"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, User, Calendar, Hash, Users, FileText } from "lucide-react";
import { Classroom } from "@/lib/types";

interface AboutTabProps {
  classroom: Classroom;
  postCount?: number;
  classworkCount?: number;
}

function formatDate(value: any): string {
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "Unknown";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function AboutTab({ classroom, postCount, classworkCount }: AboutTabProps) {
  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-600" />
            {classroom.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {classroom.description && <p className="text-sm text-gray-700 whitespace-pre-wrap">{classroom.description}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 font-medium">Subject</p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{classroom.subject}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 font-medium">Section</p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{classroom.section}</p>
            </div>
            {classroom.semester && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 font-medium">Semester</p>
                <p className="text-sm font-semibold text-gray-800 mt-1">{classroom.semester}</p>
              </div>
            )}
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                <User className="h-3 w-3" /> Teacher
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{classroom.teacherName}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Created
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-1">{formatDate(classroom.createdAt)}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 font-medium flex items-center gap-1">
                <Hash className="h-3 w-3" /> Classroom Code
              </p>
              <p className="text-sm font-semibold text-gray-800 mt-1 font-mono tracking-wider">{classroom.code}</p>
            </div>
          </div>

          <Badge variant="outline" className={classroom.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}>
            {classroom.status === "active" ? "Active" : "Archived"}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <Users className="h-6 w-6 text-blue-600 mx-auto mb-1" />
              <p className="text-2xl font-bold">{classroom.studentCount ?? 0}</p>
              <p className="text-xs text-gray-500">Students</p>
            </div>
            <div>
              <FileText className="h-6 w-6 text-purple-600 mx-auto mb-1" />
              <p className="text-2xl font-bold">{postCount ?? "-"}</p>
              <p className="text-xs text-gray-500">Stream Posts</p>
            </div>
            <div>
              <BookOpen className="h-6 w-6 text-emerald-600 mx-auto mb-1" />
              <p className="text-2xl font-bold">{classworkCount ?? "-"}</p>
              <p className="text-xs text-gray-500">Classwork Items</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
