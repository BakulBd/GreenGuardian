"use client";

import { useEffect, useState, useRef } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Eye, 
  Users, 
  AlertTriangle, 
  Clock, 
  RefreshCw,
  Camera,
  XCircle,
  CheckCircle,
  AlertCircle,
  Activity,
  MonitorStop
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher, getSessionsByExam } from "@/lib/firebase/exams";
import { Exam, ExamSession } from "@/lib/types";
import { collection, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface LiveSession extends ExamSession {
  examTitle?: string;
  warningCount: number;
  lastActivity?: Date;
  isOnline: boolean;
}

export default function TeacherMonitoringPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (user) {
      loadExams();
    }
  }, [user]);

  useEffect(() => {
    if (selectedExamId) {
      loadLiveSessions(selectedExamId);
    }
  }, [selectedExamId]);

  useEffect(() => {
    if (autoRefresh && selectedExamId) {
      refreshIntervalRef.current = setInterval(() => {
        loadLiveSessions(selectedExamId);
      }, 10000); // Refresh every 10 seconds
    }
    
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, selectedExamId]);

  const loadExams = async () => {
    try {
      const teacherExams = await getExamsByTeacher(user!.id);
      // Filter active exams
      const activeExams = teacherExams.filter(e => e.status === "active" || e.status === "published");
      setExams(activeExams);
      
      if (activeExams.length > 0) {
        setSelectedExamId(activeExams[0].id);
      }
    } catch (error) {
      console.error("Error loading exams:", error);
      toast({ title: "Error", description: "Failed to load exams", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadLiveSessions = async (examId: string) => {
    try {
      const sessions = await getSessionsByExam(examId);
      const exam = exams.find(e => e.id === examId);
      
      // Map sessions to LiveSession format
      const live: LiveSession[] = sessions
        .filter(s => s.status === "in-progress")
        .map(session => ({
          ...session,
          examTitle: exam?.title,
          warningCount: session.proctoring?.suspiciousEvents || 0,
          lastActivity: session.updatedAt instanceof Date ? session.updatedAt : 
            (session.updatedAt as any)?.toDate?.() || new Date(),
          isOnline: true, // Could be enhanced with real-time presence
        }));
      
      setLiveSessions(live);
    } catch (error) {
      console.error("Error loading sessions:", error);
    }
  };

  const handleManualRefresh = () => {
    if (selectedExamId) {
      loadLiveSessions(selectedExamId);
      toast({ title: "Refreshed", description: "Session data updated" });
    }
  };

  const selectedExam = exams.find(e => e.id === selectedExamId);
  
  const sessionStats = {
    total: liveSessions.length,
    active: liveSessions.filter(s => s.isOnline).length,
    flagged: liveSessions.filter(s => s.warningCount >= 3).length,
    warnings: liveSessions.reduce((acc, s) => acc + s.warningCount, 0),
  };

  const getWarningLevel = (count: number) => {
    if (count >= 5) return { level: "Critical", color: "bg-red-100 text-red-700", icon: XCircle };
    if (count >= 3) return { level: "High", color: "bg-orange-100 text-orange-700", icon: AlertTriangle };
    if (count >= 1) return { level: "Low", color: "bg-yellow-100 text-yellow-700", icon: AlertCircle };
    return { level: "None", color: "bg-green-100 text-green-700", icon: CheckCircle };
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Live Monitoring</h1>
            <p className="text-gray-600 mt-2">Monitor student exam sessions in real-time</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <Activity className={`h-4 w-4 mr-2 ${autoRefresh ? "animate-pulse" : ""}`} />
              Auto Refresh {autoRefresh ? "ON" : "OFF"}
            </Button>
            <Button variant="outline" onClick={handleManualRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Exam Selector */}
        <Card>
          <CardHeader>
            <CardTitle>Select Exam</CardTitle>
            <CardDescription>Choose an active exam to monitor</CardDescription>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <p className="text-gray-500">No active exams to monitor</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {exams.map((exam) => (
                  <Button
                    key={exam.id}
                    variant={selectedExamId === exam.id ? "default" : "outline"}
                    onClick={() => setSelectedExamId(exam.id)}
                  >
                    {exam.title}
                    <Badge className="ml-2" variant="secondary">
                      {exam.status}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Overview */}
        {selectedExamId && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-100 rounded-lg">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Total Sessions</p>
                    <p className="text-2xl font-bold">{sessionStats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <div className="p-3 bg-green-100 rounded-lg">
                    <Activity className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Active Now</p>
                    <p className="text-2xl font-bold">{sessionStats.active}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <div className="p-3 bg-red-100 rounded-lg">
                    <AlertTriangle className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Flagged</p>
                    <p className="text-2xl font-bold">{sessionStats.flagged}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center">
                  <div className="p-3 bg-yellow-100 rounded-lg">
                    <Eye className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm text-gray-600">Total Warnings</p>
                    <p className="text-2xl font-bold">{sessionStats.warnings}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Live Sessions */}
        {selectedExamId && (
          <Card>
            <CardHeader>
              <CardTitle>Live Sessions</CardTitle>
              <CardDescription>
                {selectedExam?.title} - Students currently taking the exam
              </CardDescription>
            </CardHeader>
            <CardContent>
              {liveSessions.length === 0 ? (
                <div className="text-center py-12">
                  <MonitorStop className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Sessions</h3>
                  <p className="text-gray-600">
                    No students are currently taking this exam. Sessions will appear here when students start.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {liveSessions.map((session) => {
                    const warning = getWarningLevel(session.warningCount);
                    const WarningIcon = warning.icon;
                    
                    return (
                      <Card key={session.id} className={session.warningCount >= 3 ? "border-red-200" : ""}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              {/* Status indicator */}
                              <div className="relative">
                                <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                                  <Camera className="h-6 w-6 text-gray-600" />
                                </div>
                                <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${
                                  session.isOnline ? "bg-green-500" : "bg-gray-400"
                                } border-2 border-white`} />
                              </div>
                              
                              {/* Student info */}
                              <div>
                                <p className="font-medium text-gray-900">
                                  {session.studentName || `Student ${session.studentId.slice(0, 8)}...`}
                                </p>
                                <div className="flex items-center space-x-2 text-sm text-gray-600">
                                  <Clock className="h-3 w-3" />
                                  <span>
                                    Started: {session.startTime instanceof Date ? session.startTime.toLocaleTimeString() : 
                                      (session.startTime as any)?.toDate?.()?.toLocaleTimeString() || "Unknown"}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Warning status */}
                            <div className="flex items-center space-x-4">
                              <div className="text-right">
                                <div className="flex items-center space-x-2">
                                  <Badge className={warning.color}>
                                    <WarningIcon className="h-3 w-3 mr-1" />
                                    {session.warningCount} Warnings
                                  </Badge>
                                </div>
                                <p className="text-sm text-gray-600 mt-1">
                                  Risk: {warning.level}
                                </p>
                              </div>

                              {/* Progress */}
                              <div className="w-32">
                                <p className="text-xs text-gray-600 mb-1">Progress</p>
                                <Progress 
                                  value={50} // Placeholder - actual progress would come from answers count
                                />
                              </div>

                              {/* Actions */}
                              <Button variant="outline" size="sm">
                                <Eye className="h-4 w-4 mr-2" />
                                View Details
                              </Button>
                            </div>
                          </div>

                          {/* Proctoring events */}
                          {session.proctoring && (
                            <div className="mt-4 pt-4 border-t">
                              <p className="text-sm font-medium text-gray-700 mb-2">Recent Events:</p>
                              <div className="flex flex-wrap gap-2">
                                {session.proctoring.tabSwitches > 0 && (
                                  <Badge variant="outline" className="text-yellow-700">
                                    Tab Switches: {session.proctoring.tabSwitches}
                                  </Badge>
                                )}
                                {session.proctoring.noFaceDuration > 0 && (
                                  <Badge variant="outline" className="text-red-700">
                                    Face Not Detected: {session.proctoring.noFaceDuration}s
                                  </Badge>
                                )}
                                {session.proctoring.multipleFacesCount > 0 && (
                                  <Badge variant="outline" className="text-red-700">
                                    Multiple Faces: {session.proctoring.multipleFacesCount}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
