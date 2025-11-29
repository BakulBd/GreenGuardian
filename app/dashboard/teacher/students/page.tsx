"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  Users, 
  Mail, 
  Calendar, 
  Search,
  FileText,
  Award,
  TrendingUp,
  Clock,
  Eye,
  BarChart
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher, getSessionsByExam } from "@/lib/firebase/exams";
import { Exam, ExamSession } from "@/lib/types";
import { formatDate } from "@/lib/utils/helpers";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface StudentData {
  id: string;
  name: string;
  email: string;
  examsCompleted: number;
  avgScore: number;
  lastExamDate?: Date;
  totalWarnings: number;
  sessions: ExamSession[];
}

export default function TeacherStudentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentData | null>(null);

  useEffect(() => {
    if (user) {
      loadStudents();
    }
  }, [user]);

  const loadStudents = async () => {
    try {
      // Get teacher's exams
      const teacherExams = await getExamsByTeacher(user!.id);
      
      // Get all sessions for these exams
      const allSessions: ExamSession[] = [];
      for (const exam of teacherExams) {
        const sessions = await getSessionsByExam(exam.id);
        sessions.forEach(s => {
          (s as any).examTitle = exam.title;
        });
        allSessions.push(...sessions);
      }
      
      // Group sessions by student
      const studentMap = new Map<string, StudentData>();
      
      for (const session of allSessions) {
        const studentId = session.studentId;
        
        if (!studentMap.has(studentId)) {
          // Try to get student info
          const studentInfo = await getStudentInfo(studentId);
          studentMap.set(studentId, {
            id: studentId,
            name: studentInfo?.name || session.studentName || `Student ${studentId.slice(0, 8)}`,
            email: studentInfo?.email || "Unknown",
            examsCompleted: 0,
            avgScore: 0,
            totalWarnings: 0,
            sessions: [],
          });
        }
        
        const student = studentMap.get(studentId)!;
        student.sessions.push(session);
        
        if (session.status === "submitted" || session.status === "auto-submitted") {
          student.examsCompleted++;
          if (session.score !== undefined) {
            student.avgScore = (student.avgScore * (student.examsCompleted - 1) + session.score) / student.examsCompleted;
          }
        }
        
        student.totalWarnings += session.proctoring?.suspiciousEvents || 0;
        
        const sessionDate = session.endTime ? 
          (session.endTime instanceof Date ? session.endTime : (session.endTime as any)?.toDate?.()) : 
          (session.startTime instanceof Date ? session.startTime : (session.startTime as any)?.toDate?.());
        if (sessionDate && (!student.lastExamDate || sessionDate > student.lastExamDate)) {
          student.lastExamDate = sessionDate;
        }
      }
      
      setStudents(Array.from(studentMap.values()));
    } catch (error) {
      console.error("Error loading students:", error);
      toast({ title: "Error", description: "Failed to load students", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const getStudentInfo = async (userId: string) => {
    try {
      const q = query(collection(db, "users"), where("__name__", "==", userId));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return snapshot.docs[0].data() as { name: string; email: string };
      }
    } catch (error) {
      console.error("Error getting student info:", error);
    }
    return null;
  };

  const filteredStudents = students.filter(student =>
    student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    student.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalStats = {
    students: students.length,
    totalExams: students.reduce((acc, s) => acc + s.examsCompleted, 0),
    avgScore: students.length > 0 
      ? students.reduce((acc, s) => acc + s.avgScore, 0) / students.length 
      : 0,
    totalWarnings: students.reduce((acc, s) => acc + s.totalWarnings, 0),
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Students</h1>
          <p className="text-gray-600 mt-2">
            View students who have taken your exams
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Total Students</p>
                  <p className="text-2xl font-bold">{totalStats.students}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-green-100 rounded-lg">
                  <FileText className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Exams Completed</p>
                  <p className="text-2xl font-bold">{totalStats.totalExams}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Award className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Average Score</p>
                  <p className="text-2xl font-bold">{totalStats.avgScore.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <TrendingUp className="h-6 w-6 text-yellow-600" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Total Warnings</p>
                  <p className="text-2xl font-bold">{totalStats.totalWarnings}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center space-x-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search students by name or email..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Students List */}
        <Card>
          <CardHeader>
            <CardTitle>Students</CardTitle>
            <CardDescription>
              Students who have attempted your exams
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="text-center py-12">
                <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Students Found</h3>
                <p className="text-gray-600">
                  {searchQuery 
                    ? "No students match your search criteria" 
                    : "No students have taken your exams yet"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Student</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Exams</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Avg Score</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Warnings</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Last Exam</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((student) => (
                      <tr key={student.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center mr-3">
                              <span className="text-primary-600 font-medium">
                                {student.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{student.name}</p>
                              <p className="text-sm text-gray-600">{student.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="secondary">
                            {student.examsCompleted} completed
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-medium ${
                            student.avgScore >= 70 ? "text-green-600" :
                            student.avgScore >= 50 ? "text-yellow-600" :
                            "text-red-600"
                          }`}>
                            {student.avgScore.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className={
                            student.totalWarnings >= 10 ? "bg-red-100 text-red-700" :
                            student.totalWarnings >= 5 ? "bg-yellow-100 text-yellow-700" :
                            "bg-green-100 text-green-700"
                          }>
                            {student.totalWarnings}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {student.lastExamDate 
                            ? formatDate(student.lastExamDate)
                            : "-"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setSelectedStudent(student)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Student Details Modal/Card */}
        {selectedStudent && (
          <Card className="border-primary-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{selectedStudent.name}</CardTitle>
                  <CardDescription>{selectedStudent.email}</CardDescription>
                </div>
                <Button variant="ghost" onClick={() => setSelectedStudent(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <h4 className="font-medium text-gray-900 mb-4">Exam History</h4>
              <div className="space-y-3">
                {selectedStudent.sessions.map((session) => (
                  <div 
                    key={session.id} 
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{(session as any).examTitle || "Exam"}</p>
                      <div className="flex items-center space-x-2 text-sm text-gray-600">
                        <Clock className="h-3 w-3" />
                        <span>
                          {session.startTime instanceof Date ? session.startTime.toLocaleDateString() : 
                            (session.startTime as any)?.toDate?.()?.toLocaleDateString() || "Unknown date"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <Badge className={
                        (session.status === "submitted" || session.status === "auto-submitted") ? "bg-green-100 text-green-700" :
                        session.status === "in-progress" ? "bg-blue-100 text-blue-700" :
                        "bg-gray-100 text-gray-700"
                      }>
                        {session.status}
                      </Badge>
                      {session.score !== undefined && (
                        <span className="font-medium">{session.score}%</span>
                      )}
                      <Badge variant="outline">
                        {session.proctoring?.suspiciousEvents || 0} warnings
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
