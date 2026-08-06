"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
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
  MonitorStop,
  Image as ImageIcon
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import LiveVideoTile from "@/components/LiveVideoTile";
import ExamSuspendControl from "@/components/ExamSuspendControl";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher } from "@/lib/firebase/exams";
import { Exam } from "@/lib/types";
import { subscribeToLiveSessions, LiveStudentSession } from "@/lib/services/proctoring";

export default function TeacherMonitoringPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [liveSessions, setLiveSessions] = useState<LiveStudentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Store the unsubscribe function for cleanup
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (user) {
      loadExams();
    }
  }, [user]);

  useEffect(() => {
    // Cleanup previous subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (selectedExamId && autoRefresh) {
      // Start real-time listener
      const unsubscribe = subscribeToLiveSessions(selectedExamId, (sessions) => {
        setLiveSessions(sessions);
      });
      unsubscribeRef.current = unsubscribe;
    } else if (selectedExamId && !autoRefresh) {
      // Fetch once (by subscribing and immediately unsubscribing after first payload)
      // For simplicity, we just leave it subscribed but only start it if autoRefresh is true.
      // If user toggles off, we just clear the listener.
      const unsubscribe = subscribeToLiveSessions(selectedExamId, (sessions) => {
        setLiveSessions(sessions);
        unsubscribe();
        unsubscribeRef.current = null;
      });
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [selectedExamId, autoRefresh]);

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

  const handleManualRefresh = () => {
    if (selectedExamId) {
      // Temporarily trigger a one-off fetch by re-subscribing
      if (!autoRefresh) {
        const unsubscribe = subscribeToLiveSessions(selectedExamId, (sessions) => {
          setLiveSessions(sessions);
          unsubscribe();
        });
      }
      toast({ title: "Refreshed", description: "Session data updated" });
    }
  };

  const selectedExam = exams.find(e => e.id === selectedExamId);
  
  const sessionStats = {
    total: liveSessions.length,
    active: liveSessions.filter(s => s.isOnline).length,
    flagged: liveSessions.filter(s => s.hasAlert).length,
    warnings: liveSessions.reduce((acc, s) => acc + s.warningCount, 0),
  };

  const getWarningLevel = (riskLevel: string) => {
    switch (riskLevel) {
      case 'critical': return { level: "Critical", color: "bg-red-100 text-red-700 border-red-200", icon: XCircle };
      case 'high': return { level: "High", color: "bg-orange-100 text-orange-700 border-orange-200", icon: AlertTriangle };
      case 'medium': return { level: "Medium", color: "bg-yellow-100 text-yellow-700 border-yellow-200", icon: AlertCircle };
      case 'low': 
      default: return { level: "Low", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle };
    }
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
              className={autoRefresh ? "bg-emerald-600 hover:bg-emerald-700" : ""}
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
                    <p className="text-sm text-gray-600">Alerts</p>
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
                <div className="grid grid-cols-1 gap-4">
                  {liveSessions.map((session) => {
                    const warning = getWarningLevel(session.riskLevel);
                    const WarningIcon = warning.icon;
                    
                    return (
                      <Card key={session.sessionId} className={`overflow-hidden border-l-4 ${
                        session.riskLevel === 'critical' ? 'border-l-red-500' :
                        session.riskLevel === 'high' ? 'border-l-orange-500' :
                        session.riskLevel === 'medium' ? 'border-l-yellow-500' : 'border-l-green-500'
                      }`}>
                        <CardContent className="p-0">
                          <div className="flex flex-col md:flex-row">
                            
                            {/* Snapshot Display */}
                            <div className="bg-black flex-shrink-0 relative h-32 md:h-auto md:w-48 flex items-center justify-center">
                              <LiveVideoTile
                                sessionId={session.sessionId}
                                studentName={session.studentName}
                                fallbackSnapshotUrl={session.latestSnapshot?.snapshotUrl}
                                quality="thumb"
                                viewerName={user?.name || user?.email}
                                hideBadge
                              />
                              <div className="absolute top-2 right-2">
                                <div className={`w-3 h-3 rounded-full border border-white ${session.isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                              </div>
                            </div>
                            
                            {/* Session Details */}
                            <div className="p-4 flex-1 flex flex-col justify-between">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h3 className="font-bold text-lg text-gray-900">
                                    {session.studentName}
                                  </h3>
                                  <div className="flex items-center space-x-2 text-sm text-gray-500 mt-1">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span>
                                      Started: {session.startTime.toLocaleTimeString()}
                                    </span>
                                  </div>
                                </div>
                                
                                <div className="text-right">
                                  <Badge className={`border ${warning.color}`}>
                                    <WarningIcon className="h-3 w-3 mr-1" />
                                    {warning.level} Risk
                                  </Badge>
                                  <p className="text-sm font-medium mt-2 text-gray-700">
                                    Behavior: {session.behaviorScore}/100
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4 flex flex-col md:flex-row justify-between items-end gap-4">
                                <div className="flex-1 space-y-2">
                                  {session.recentEvents && session.recentEvents.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Alerts:</span>
                                      {session.recentEvents.slice(0, 3).map((event, i) => (
                                        <Badge key={i} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                                          {event.message}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <span className="text-xs font-semibold text-gray-500 uppercase mr-1">Warnings Total:</span>
                                    <span className="text-xs font-bold text-gray-900">{session.warningCount}</span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <ExamSuspendControl
                                    sessionId={session.sessionId}
                                    studentName={session.studentName}
                                    locked={session.locked}
                                  />
                                  <Button variant="outline" size="sm" onClick={() => router.push(`/dashboard/teacher/session-results?sessionId=${session.sessionId}`) }>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Full Details
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
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
