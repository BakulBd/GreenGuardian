"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Camera,
  CameraOff,
  Wifi,
  WifiOff,
  AlertTriangle,
  Clock,
  Users,
  Monitor,
  Maximize2,
  Eye,
  History,
  Image,
  Shield,
  Activity,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import LiveVideoTile from "@/components/LiveVideoTile";
import { LiveTransport } from "@/lib/services/liveVideo";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher } from "@/lib/firebase/exams";
import { Exam } from "@/lib/types";
import {
  subscribeToLiveSessions,
  LiveStudentSession,
  getSessionEvents,
  getSessionSnapshots,
  getWarningScreenshots,
  ProctoringEvent,
  ProctoringSnapshot,
  WarningScreenshot,
} from "@/lib/services/proctoring";
import { getBehaviorLevel } from "@/lib/utils/helpers";

// Grid helper: determine columns based on student count
function getGridCols(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 9) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
}

export default function TeacherWatchLivePage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [liveSessions, setLiveSessions] = useState<LiveStudentSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Fullscreen state
  const [fullscreenStudent, setFullscreenStudent] = useState<LiveStudentSession | null>(null);

  // Detail dialog state
  const [selectedStudent, setSelectedStudent] = useState<LiveStudentSession | null>(null);
  const [studentEvents, setStudentEvents] = useState<ProctoringEvent[]>([]);
  const [studentSnapshots, setProctoringSnapshots] = useState<ProctoringSnapshot[]>([]);
  const [studentWarningScreenshots, setStudentWarningScreenshots] = useState<WarningScreenshot[]>([]);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  // Which transport each tile is currently receiving video on.
  const [transports, setTransports] = useState<Record<string, LiveTransport>>({});

  const unsubscribeRef = useRef<(() => void) | null>(null);

  const trackTransport = useCallback(
    (sessionId: string) => (transport: LiveTransport) => {
      setTransports((prev) => (prev[sessionId] === transport ? prev : { ...prev, [sessionId]: transport }));
    },
    []
  );

  useEffect(() => {
    if (user) {
      loadExams();
    }
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [user]);

  useEffect(() => {
    if (selectedExamId) {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      unsubscribeRef.current = subscribeToLiveSessions(
        selectedExamId,
        (sessions) => {
          setLiveSessions(sessions);
        }
      );
    }
  }, [selectedExamId]);

  const loadExams = async () => {
    try {
      const teacherExams = await getExamsByTeacher(user!.id);
      const activeExams = teacherExams.filter(
        (e) => e.status === "active" || e.status === "published"
      );
      // Also include exams that have in-progress sessions even if not "active"
      setExams(activeExams);
      if (activeExams.length > 0) {
        setSelectedExamId(activeExams[0].id);
      }
    } catch (error) {
      console.error("Error loading exams:", error);
      toast({
        title: "Error",
        description: "Failed to load exams",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleViewStudentDetails = async (session: LiveStudentSession) => {
    setSelectedStudent(session);
    setShowDetailDialog(true);
    try {
      const [events, snapshots, warningScreenshots] = await Promise.all([
        getSessionEvents(session.sessionId),
        getSessionSnapshots(session.sessionId, 20),
        getWarningScreenshots(session.sessionId),
      ]);
      setStudentEvents(events);
      setProctoringSnapshots(snapshots);
      setStudentWarningScreenshots(warningScreenshots);
    } catch (error) {
      console.error("Error loading student details:", error);
    }
  };

  const selectedExam = exams.find((e) => e.id === selectedExamId);

  // Stats
  const totalStudents = liveSessions.length;
  const onlineStudents = liveSessions.filter((s) => s.isOnline).length;
  const offlineStudents = totalStudents - onlineStudents;
  const warnedStudents = liveSessions.filter((s) => s.warningCount > 0).length;
  const criticalStudents = liveSessions.filter((s) => s.riskLevel === "critical").length;

  const getRiskColor = (level: string) => {
    switch (level) {
      case "critical":
        return "bg-red-500 text-white";
      case "high":
        return "bg-orange-500 text-white";
      case "medium":
        return "bg-yellow-500 text-white";
      default:
        return "bg-green-500 text-white";
    }
  };

  const getRiskBorderColor = (level: string) => {
    switch (level) {
      case "critical":
        return "border-red-500 ring-2 ring-red-200";
      case "high":
        return "border-orange-400";
      case "medium":
        return "border-yellow-400";
      default:
        return "border-green-400";
    }
  };

  // Camera status now reflects the *actual* live transport, so the badge is
  // meaningful on the deployed site (not just "a snapshot exists").
  const getCameraStatus = (session: LiveStudentSession) => {
    const transport = transports[session.sessionId] || "none";
    if (transport === "webrtc") return { label: "Live HD", color: "bg-green-500 animate-pulse", icon: Camera };
    if (transport === "relay" || transport === "local")
      return { label: "Live", color: "bg-green-500 animate-pulse", icon: Camera };
    if (!session.isOnline) return { label: "Offline", color: "bg-gray-400", icon: WifiOff };
    if (!session.latestSnapshot?.snapshotUrl) return { label: "Camera Off", color: "bg-yellow-400", icon: CameraOff };
    return { label: "Snapshot", color: "bg-yellow-400", icon: Camera };
  };

  // Fullscreen viewer component
  const FullscreenViewer = () => {
    if (!fullscreenStudent) return null;
    const cameraStatus = getCameraStatus(fullscreenStudent);

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900/90">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10"
              onClick={() => setFullscreenStudent(null)}
            >
              <ChevronLeft className="h-5 w-5 mr-1" />
              Back
            </Button>
            <div>
              <h2 className="text-white font-semibold">{fullscreenStudent.studentName}</h2>
              <p className="text-gray-400 text-sm">{selectedExam?.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getRiskColor(fullscreenStudent.riskLevel)}>
              {fullscreenStudent.riskLevel.toUpperCase()} Risk
            </Badge>
            <Badge className={cameraStatus.color}>
              {cameraStatus.label}
            </Badge>
          </div>
        </div>

        {/* Video Feed — high quality stream for the focused student */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full h-full max-w-5xl rounded-lg overflow-hidden">
            <LiveVideoTile
              sessionId={fullscreenStudent.sessionId}
              studentName={fullscreenStudent.studentName}
              fallbackSnapshotUrl={fullscreenStudent.latestSnapshot?.snapshotUrl}
              quality="high"
              viewerName={user?.name || user?.email}
              onTransportChange={trackTransport(fullscreenStudent.sessionId)}
            />
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="px-4 py-3 bg-gray-900/90 flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-1">
              <Activity className="h-4 w-4" />
              Live Feed
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              Warnings: {fullscreenStudent.warningCount}
            </span>
            <span className="flex items-center gap-1">
              <Shield className="h-4 w-4" />
              Score: {fullscreenStudent.behaviorScore}/100
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-white border-white/20 hover:bg-white/10"
            onClick={() => {
              setFullscreenStudent(null);
              handleViewStudentDetails(fullscreenStudent);
            }}
          >
            <Eye className="h-4 w-4 mr-1" />
            View Details
          </Button>
        </div>
      </div>
    );
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Watch Live</h1>
            <p className="text-sm md:text-base text-gray-600 mt-1">
              Monitor all active exam students&apos; live camera feeds in real-time
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1 px-3 py-1.5">
              <Activity className="h-3.5 w-3.5 text-green-500 animate-pulse" />
              <span className="text-green-600 font-medium">LIVE</span>
            </Badge>
            <Badge variant="secondary" className="px-3 py-1.5">
              <Camera className="h-3.5 w-3.5 mr-1" />
              {onlineStudents} / {totalStudents} online
            </Badge>
          </div>
        </div>

        {/* Exam Selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Select Active Exam</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading exams...
              </div>
            ) : exams.length === 0 ? (
              <p className="text-gray-500">
                No active exams. Publish an exam and students must start it to appear here.
              </p>
            ) : (
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex gap-2 pb-2">
                  {exams.map((exam) => (
                    <Button
                      key={exam.id}
                      variant={selectedExamId === exam.id ? "default" : "outline"}
                      onClick={() => setSelectedExamId(exam.id)}
                      className="flex-shrink-0"
                    >
                      {exam.title}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {/* Stats Bar */}
        {selectedExamId && totalStudents > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Students</p>
                  <p className="text-xl font-bold">{totalStudents}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Camera className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Live</p>
                  <p className="text-xl font-bold">{onlineStudents}</p>
                </div>
              </CardContent>
            </Card>
            <Card className={warnedStudents > 0 ? "border-yellow-300 bg-yellow-50" : ""}>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <div className="p-2 bg-yellow-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Warned</p>
                  <p className="text-xl font-bold">{warnedStudents}</p>
                </div>
              </CardContent>
            </Card>
            <Card className={criticalStudents > 0 ? "border-red-300 bg-red-50" : ""}>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <Shield className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Critical</p>
                  <p className="text-xl font-bold">{criticalStudents}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Live Camera Grid */}
        {selectedExamId && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Live Camera Grid</CardTitle>
                  <CardDescription className="mt-1">
                    {selectedExam?.title} — {totalStudents} student{totalStudents !== 1 ? "s" : ""} in session
                  </CardDescription>
                </div>
                <Badge variant="outline" className="flex items-center gap-1 px-3 py-1.5">
                  <Activity className="h-3 w-3 animate-pulse text-green-500" />
                  Live
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {totalStudents === 0 ? (
                <div className="text-center py-16">
                  <CameraOff className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Students</h3>
                  <p className="text-gray-500 max-w-md mx-auto">
                    Waiting for students to start the exam. Live camera feeds will appear here automatically.
                  </p>
                </div>
              ) : (
                <>
                  {/* Grid Layout - Google Meet/Zoom style */}
                  <div className={getGridCols(totalStudents) + " gap-4"}>
                    {liveSessions.map((session) => {
                      const cameraStatus = getCameraStatus(session);
                      const CameraIcon = cameraStatus.icon;
                      const behaviorLevel = getBehaviorLevel(session.behaviorScore);
                      const hasWarning = session.warningCount > 0;

                      return (
                        <Card
                          key={session.sessionId}
                          className={`relative overflow-hidden transition-all hover:shadow-lg ${getRiskBorderColor(session.riskLevel)}`}
                        >
                          {/* Camera Feed Area */}
                          <div className="relative aspect-video bg-gray-900 group">
                            <LiveVideoTile
                              sessionId={session.sessionId}
                              studentName={session.studentName}
                              fallbackSnapshotUrl={session.latestSnapshot?.snapshotUrl}
                              quality="thumb"
                              viewerName={user?.name || user?.email}
                              hideBadge
                              onTransportChange={trackTransport(session.sessionId)}
                            />

                            {/* Overlay badges */}
                            <div className="absolute top-2 left-2 flex items-center gap-1.5">
                              {/* Connection Status */}
                              <Badge
                                className={`${
                                  session.isOnline
                                    ? "bg-green-500/80 text-white"
                                    : "bg-gray-500/80 text-white"
                                } text-[10px] px-1.5 py-0.5`}
                              >
                                {session.isOnline ? (
                                  <Wifi className="h-2.5 w-2.5 mr-0.5" />
                                ) : (
                                  <WifiOff className="h-2.5 w-2.5 mr-0.5" />
                                )}
                                {session.isOnline ? "Online" : "Offline"}
                              </Badge>

                              {/* Camera Status */}
                              <Badge
                                className={`${
                                  cameraStatus.label === "Live"
                                    ? "bg-green-500/80 text-white"
                                    : cameraStatus.label === "Camera Off"
                                    ? "bg-yellow-500/80 text-white"
                                    : "bg-gray-500/80 text-white"
                                } text-[10px] px-1.5 py-0.5`}
                              >
                                <CameraIcon className="h-2.5 w-2.5 mr-0.5" />
                                {cameraStatus.label}
                              </Badge>
                            </div>

                            {/* Risk Level Badge */}
                            <div className="absolute top-2 right-2">
                              <Badge className={getRiskColor(session.riskLevel) + " text-[10px]"}>
                                {session.riskLevel.toUpperCase()}
                              </Badge>
                            </div>

                            {/* Hover overlay controls */}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <div className="flex gap-2">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="bg-white/90 hover:bg-white text-gray-900"
                                  onClick={() => setFullscreenStudent(session)}
                                >
                                  <Maximize2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="bg-white/90 hover:bg-white text-gray-900"
                                  onClick={() => handleViewStudentDetails(session)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            {/* Alert Indicator */}
                            {hasWarning && (
                              <div className="absolute bottom-2 right-2 animate-pulse">
                                <AlertTriangle className="h-5 w-5 text-red-500 drop-shadow-lg" />
                              </div>
                            )}
                          </div>

                          {/* Student Info */}
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm truncate text-gray-900">
                                  {session.studentName}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                  ID: {session.studentId.slice(0, 8)}...
                                </p>
                              </div>
                              <Badge
                                variant="secondary"
                                className={
                                  behaviorLevel.badge + " ml-2 flex-shrink-0"
                                }
                              >
                                {session.behaviorScore}
                              </Badge>
                            </div>

                            {/* AI Status & Exam Info */}
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Shield className="h-3 w-3 text-blue-500" />
                              <span>AI Monitoring</span>
                              <CheckCircle className="h-3 w-3 text-green-500" />
                              <span>Active</span>
                            </div>

                            {/* Warning Info */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <AlertTriangle
                                  className={`h-3.5 w-3.5 ${
                                    hasWarning ? "text-red-500" : "text-gray-400"
                                  }`}
                                />
                                <span
                                  className={`text-xs font-medium ${
                                    hasWarning ? "text-red-600" : "text-gray-500"
                                  }`}
                                >
                                  Warnings: {session.warningCount}
                                </span>
                              </div>
                              <span className="text-xs text-gray-400">
                                <Clock className="h-3 w-3 inline mr-0.5" />
                                {session.startTime.toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>

                            {/* Latest Warning */}
                            {hasWarning && session.alertReasons.length > 0 && (
                              <div className="bg-red-50 border border-red-200 rounded px-2 py-1">
                                <p className="text-[10px] text-red-700 truncate">
                                  ⚠️ Latest: {session.alertReasons[0]}
                                </p>
                              </div>
                            )}

                            {/* Behavior Score Progress */}
                            <Progress
                              value={session.behaviorScore}
                              className="h-1.5"
                            />
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Fullscreen Viewer */}
      {fullscreenStudent && <FullscreenViewer />}

      {/* Student Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedStudent && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  {selectedStudent.studentName}
                  <Badge className={getRiskColor(selectedStudent.riskLevel)}>
                    {selectedStudent.riskLevel.toUpperCase()}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Student ID: {selectedStudent.studentId} | Exam: {selectedExam?.title}
                </DialogDescription>
              </DialogHeader>

              {/* Quick Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-xs text-gray-500">Behavior Score</p>
                    <p className="text-2xl font-bold">{selectedStudent.behaviorScore}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-xs text-gray-500">Warnings</p>
                    <p className="text-2xl font-bold">{selectedStudent.warningCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-xs text-gray-500">Alerts</p>
                    <p className="text-2xl font-bold">{selectedStudent.alertReasons.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-xs text-gray-500">Online</p>
                    <p className="text-2xl font-bold">
                      {selectedStudent.isOnline ? (
                        <span className="text-green-600">Yes</span>
                      ) : (
                        <span className="text-gray-400">No</span>
                      )}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="snapshot" className="mt-4">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="snapshot">Live Video</TabsTrigger>
                  <TabsTrigger value="events">
                    Events ({studentEvents.length})
                  </TabsTrigger>
                  <TabsTrigger value="snapshots">
                    Snapshots ({studentSnapshots.length})
                  </TabsTrigger>
                  <TabsTrigger value="warning-screenshots">
                    Warning SS ({studentWarningScreenshots.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="snapshot" className="mt-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="w-full max-w-2xl mx-auto aspect-video rounded-lg border overflow-hidden">
                        <LiveVideoTile
                          sessionId={selectedStudent.sessionId}
                          studentName={selectedStudent.studentName}
                          fallbackSnapshotUrl={selectedStudent.latestSnapshot?.snapshotUrl}
                          quality="high"
                          viewerName={user?.name || user?.email}
                          onTransportChange={trackTransport(selectedStudent.sessionId)}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="events" className="mt-4">
                  <ScrollArea className="h-[350px]">
                    <div className="space-y-2">
                      {studentEvents.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">
                          No proctoring events recorded
                        </p>
                      ) : (
                        studentEvents.map((event, idx) => (
                          <Card
                            key={idx}
                            className={
                              event.severity === "critical"
                                ? "border-red-300 bg-red-50"
                                : event.severity === "high"
                                ? "border-orange-300 bg-orange-50"
                                : ""
                            }
                          >
                            <CardContent className="py-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`p-2 rounded-lg ${
                                    event.severity === "critical"
                                      ? "bg-red-200"
                                      : event.severity === "high"
                                      ? "bg-orange-200"
                                      : event.severity === "medium"
                                      ? "bg-yellow-200"
                                      : "bg-gray-200"
                                  }`}
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                </div>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">
                                    {event.message}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {new Date(
                                      event.timestamp as any
                                    ).toLocaleTimeString()}{" "}
                                    — Penalty: -{event.penalty}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className={
                                    event.severity === "critical"
                                      ? "border-red-500 text-red-700"
                                      : event.severity === "high"
                                      ? "border-orange-500 text-orange-700"
                                      : event.severity === "medium"
                                      ? "border-yellow-500 text-yellow-700"
                                      : ""
                                  }
                                >
                                  {event.severity}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="snapshots" className="mt-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {studentSnapshots.length === 0 ? (
                      <p className="col-span-full text-center text-gray-500 py-8">
                        No snapshots captured
                      </p>
                    ) : (
                      studentSnapshots.map((snapshot, idx) => (
                        <div
                          key={idx}
                          className="relative aspect-video bg-gray-100 rounded overflow-hidden group"
                        >
                          {snapshot.snapshotUrl ? (
                            <img
                              src={snapshot.snapshotUrl}
                              alt={`Snapshot ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <Image className="h-8 w-8 text-gray-400" />
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                            <p className="text-xs text-white">
                              {new Date(
                                snapshot.timestamp as any
                              ).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="warning-screenshots" className="mt-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {studentWarningScreenshots.length === 0 ? (
                      <p className="col-span-full text-center text-gray-500 py-8">
                        No warning screenshots captured
                      </p>
                    ) : (
                      studentWarningScreenshots.map((ss, idx) => (
                        <div
                          key={ss.id || idx}
                          className="relative aspect-video bg-gray-100 rounded overflow-hidden border border-red-200 group"
                        >
                          <img
                            src={ss.screenshotUrl}
                            alt={`Warning screenshot ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="absolute bottom-0 left-0 right-0 p-2">
                              <p className="text-xs text-white font-medium">
                                {ss.warningType.replace(/_/g, " ").toUpperCase()}
                              </p>
                              <p className="text-[10px] text-gray-300 truncate">
                                {ss.warningMessage}
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {new Date(
                                  ss.timestamp as any
                                ).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant="destructive"
                            className="absolute top-1 left-1 text-[9px] px-1 py-0"
                          >
                            ⚠️ Warning
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

