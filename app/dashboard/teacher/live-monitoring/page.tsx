"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Smartphone,
  BookOpen,
  Laptop,
  UserPlus,
  ShieldAlert,
  TrendingDown,
  History,
  Image,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Maximize2,
  ChevronDown,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { getExamsByTeacher } from "@/lib/firebase/exams";
import { Exam } from "@/lib/types";
import { 
  subscribeToLiveSessions, 
  LiveStudentSession,
  getSessionEvents,
  getSessionSnapshots,
  ProctoringEvent,
  ProctoringSnapshot 
} from "@/lib/services/proctoring";
import { getBehaviorLevel, getViolationSummary, ViolationCounts } from "@/lib/utils/helpers";

// Sound notification for critical alerts
const playAlertSound = () => {
  if (typeof window !== 'undefined') {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      console.log("Audio notification not supported");
    }
  }
};

export default function LiveMonitoringPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>("");
  const [liveSessions, setLiveSessions] = useState<LiveStudentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<LiveStudentSession | null>(null);
  const [studentEvents, setStudentEvents] = useState<ProctoringEvent[]>([]);
  const [studentSnapshots, setStudentSnapshots] = useState<ProctoringSnapshot[]>([]);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const lastAlertTimeRef = useRef<number>(0);

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
      // Unsubscribe from previous exam
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      
      // Subscribe to live sessions for selected exam
      unsubscribeRef.current = subscribeToLiveSessions(
        selectedExamId,
        handleLiveSessionsUpdate
      );
    }
  }, [selectedExamId]);

  const loadExams = async () => {
    try {
      const teacherExams = await getExamsByTeacher(user!.id);
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

  const handleLiveSessionsUpdate = useCallback((sessions: LiveStudentSession[]) => {
    setLiveSessions(sessions);
    
    // Check for critical alerts and play sound
    const now = Date.now();
    if (soundEnabled && now - lastAlertTimeRef.current > 10000) { // Max once per 10 seconds
      const hasCriticalAlert = sessions.some(s => 
        s.riskLevel === 'critical' && s.hasAlert
      );
      
      if (hasCriticalAlert) {
        playAlertSound();
        lastAlertTimeRef.current = now;
        
        toast({
          title: "⚠️ Critical Alert",
          description: "A student has triggered a critical proctoring alert",
          variant: "destructive",
        });
      }
    }
  }, [soundEnabled, toast]);

  const handleViewStudent = async (session: LiveStudentSession) => {
    setSelectedStudent(session);
    setShowDetailDialog(true);
    
    // Load events and snapshots for this student
    try {
      const [events, snapshots] = await Promise.all([
        getSessionEvents(session.sessionId),
        getSessionSnapshots(session.sessionId, 20)
      ]);
      setStudentEvents(events);
      setStudentSnapshots(snapshots);
    } catch (error) {
      console.error("Error loading student details:", error);
    }
  };

  const selectedExam = exams.find(e => e.id === selectedExamId);
  
  // Calculate stats
  const sessionStats = {
    total: liveSessions.length,
    online: liveSessions.filter(s => s.isOnline).length,
    critical: liveSessions.filter(s => s.riskLevel === 'critical').length,
    high: liveSessions.filter(s => s.riskLevel === 'high').length,
    alerts: liveSessions.filter(s => s.hasAlert).length,
    avgScore: liveSessions.length > 0 
      ? Math.round(liveSessions.reduce((acc, s) => acc + s.behaviorScore, 0) / liveSessions.length)
      : 100,
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      default: return 'bg-green-500 text-white';
    }
  };

  const getRiskBorderColor = (level: string) => {
    switch (level) {
      case 'critical': return 'border-red-500 ring-2 ring-red-200';
      case 'high': return 'border-orange-400';
      case 'medium': return 'border-yellow-400';
      default: return 'border-green-400';
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case 'mobile_phone_detected': return <Smartphone className="h-4 w-4" />;
      case 'book_detected': return <BookOpen className="h-4 w-4" />;
      case 'laptop_detected': return <Laptop className="h-4 w-4" />;
      case 'second_person_detected': return <UserPlus className="h-4 w-4" />;
      case 'no_face': return <XCircle className="h-4 w-4" />;
      case 'multiple_faces': return <Users className="h-4 w-4" />;
      case 'looking_away': return <Eye className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-4 md:space-y-6">
        {/* Header - Responsive */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Live Proctoring</h1>
            <p className="text-sm md:text-base text-gray-600 mt-1">
              Monitor student exam sessions in real-time
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={soundEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => setSoundEnabled(!soundEnabled)}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />}
              <span className="hidden sm:inline">{soundEnabled ? "Sound ON" : "Sound OFF"}</span>
            </Button>
            <div className="flex rounded-md shadow-sm">
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                className="rounded-r-none"
                onClick={() => setViewMode("grid")}
              >
                Grid
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                className="rounded-l-none"
                onClick={() => setViewMode("list")}
              >
                List
              </Button>
            </div>
          </div>
        </div>

        {/* Exam Selector - Responsive */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Select Exam</CardTitle>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <p className="text-gray-500">No active exams to monitor</p>
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

        {/* Stats Overview - Responsive Grid */}
        {selectedExamId && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="ml-3">
                    <p className="text-xs text-gray-600">Total</p>
                    <p className="text-xl font-bold">{sessionStats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <Wifi className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="ml-3">
                    <p className="text-xs text-gray-600">Online</p>
                    <p className="text-xl font-bold">{sessionStats.online}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className={sessionStats.critical > 0 ? "border-red-300 bg-red-50" : ""}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center">
                  <div className={`p-2 rounded-lg ${sessionStats.critical > 0 ? "bg-red-200" : "bg-red-100"}`}>
                    <ShieldAlert className={`h-5 w-5 ${sessionStats.critical > 0 ? "text-red-700" : "text-red-600"}`} />
                  </div>
                  <div className="ml-3">
                    <p className="text-xs text-gray-600">Critical</p>
                    <p className="text-xl font-bold">{sessionStats.critical}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className={sessionStats.high > 0 ? "border-orange-300 bg-orange-50" : ""}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                  </div>
                  <div className="ml-3">
                    <p className="text-xs text-gray-600">High Risk</p>
                    <p className="text-xl font-bold">{sessionStats.high}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div className="ml-3">
                    <p className="text-xs text-gray-600">Alerts</p>
                    <p className="text-xl font-bold">{sessionStats.alerts}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <TrendingDown className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="ml-3">
                    <p className="text-xs text-gray-600">Avg Score</p>
                    <p className="text-xl font-bold">{sessionStats.avgScore}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Live Sessions - Grid or List View */}
        {selectedExamId && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Live Sessions</CardTitle>
                  <CardDescription className="mt-1">
                    {selectedExam?.title} - Real-time monitoring
                  </CardDescription>
                </div>
                <Badge variant="outline" className="flex items-center gap-1">
                  <Activity className="h-3 w-3 animate-pulse text-green-500" />
                  Live
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {liveSessions.length === 0 ? (
                <div className="text-center py-12">
                  <MonitorStop className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Sessions</h3>
                  <p className="text-gray-600">
                    Sessions will appear here when students start the exam
                  </p>
                </div>
              ) : viewMode === "grid" ? (
                /* Grid View - Student Cards with Thumbnails */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {liveSessions.map((session) => {
                    const behaviorLevel = getBehaviorLevel(session.behaviorScore);
                    
                    return (
                      <Card 
                        key={session.sessionId} 
                        className={`relative overflow-hidden cursor-pointer transition-all hover:shadow-lg ${getRiskBorderColor(session.riskLevel)}`}
                        onClick={() => handleViewStudent(session)}
                      >
                        {/* Thumbnail / Camera View */}
                        <div className="relative aspect-video bg-gray-900">
                          {session.latestSnapshot?.snapshotUrl ? (
                            <img 
                              src={session.latestSnapshot.snapshotUrl} 
                              alt={session.studentName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Camera className="h-10 w-10 text-gray-600" />
                            </div>
                          )}
                          
                          {/* Risk Badge Overlay */}
                          <div className="absolute top-2 right-2">
                            <Badge className={getRiskColor(session.riskLevel)}>
                              {session.riskLevel.toUpperCase()}
                            </Badge>
                          </div>
                          
                          {/* Online Status */}
                          <div className="absolute top-2 left-2">
                            <div className={`w-3 h-3 rounded-full ${session.isOnline ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
                          </div>
                          
                          {/* Alert Indicator */}
                          {session.hasAlert && (
                            <div className="absolute bottom-2 right-2 animate-bounce">
                              <AlertTriangle className="h-6 w-6 text-red-500 drop-shadow-lg" />
                            </div>
                          )}
                        </div>
                        
                        {/* Student Info */}
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium text-sm truncate">
                              {session.studentName}
                            </p>
                            <Badge className={behaviorLevel.badge} variant="secondary">
                              {session.behaviorScore}
                            </Badge>
                          </div>
                          
                          {/* Progress Bar */}
                          <Progress 
                            value={session.behaviorScore} 
                            className="h-2"
                          />
                          
                          {/* Recent Alerts */}
                          {session.alertReasons.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {session.alertReasons.slice(0, 2).map((reason, idx) => (
                                <p key={idx} className="text-xs text-red-600 truncate">
                                  ⚠️ {reason}
                                </p>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                /* List View - Detailed Table */
                <div className="space-y-3">
                  {liveSessions.map((session) => {
                    const behaviorLevel = getBehaviorLevel(session.behaviorScore);
                    
                    return (
                      <Card 
                        key={session.sessionId} 
                        className={`cursor-pointer transition-all hover:shadow-md ${
                          session.hasAlert ? getRiskBorderColor(session.riskLevel) : ""
                        }`}
                        onClick={() => handleViewStudent(session)}
                      >
                        <CardContent className="p-4">
                          <div className="flex flex-col md:flex-row md:items-center gap-4">
                            {/* Thumbnail */}
                            <div className="relative w-24 h-18 flex-shrink-0 bg-gray-900 rounded overflow-hidden">
                              {session.latestSnapshot?.snapshotUrl ? (
                                <img 
                                  src={session.latestSnapshot.snapshotUrl} 
                                  alt={session.studentName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <Camera className="h-6 w-6 text-gray-600" />
                                </div>
                              )}
                              <div className={`absolute top-1 left-1 w-2 h-2 rounded-full ${session.isOnline ? "bg-green-500" : "bg-gray-400"}`} />
                            </div>
                            
                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium truncate">{session.studentName}</p>
                                <Badge className={getRiskColor(session.riskLevel)}>
                                  {session.riskLevel}
                                </Badge>
                                {session.hasAlert && (
                                  <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-gray-600">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Started: {session.startTime.toLocaleTimeString()}
                                </span>
                                <span>Warnings: {session.warningCount}</span>
                              </div>
                              {session.alertReasons.length > 0 && (
                                <p className="text-xs text-red-600 mt-1 truncate">
                                  Latest: {session.alertReasons[0]}
                                </p>
                              )}
                            </div>
                            
                            {/* Score */}
                            <div className="flex items-center gap-4">
                              <div className="text-center">
                                <p className="text-2xl font-bold">{session.behaviorScore}</p>
                                <Badge className={behaviorLevel.badge} variant="secondary">
                                  {behaviorLevel.level}
                                </Badge>
                              </div>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
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

      {/* Student Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedStudent && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedStudent.studentName}
                  <Badge className={getRiskColor(selectedStudent.riskLevel)}>
                    {selectedStudent.riskLevel}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Session started: {selectedStudent.startTime.toLocaleString()}
                </DialogDescription>
              </DialogHeader>
              
              <Tabs defaultValue="overview" className="mt-4">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="events">Events ({studentEvents.length})</TabsTrigger>
                  <TabsTrigger value="snapshots">Snapshots ({studentSnapshots.length})</TabsTrigger>
                </TabsList>
                
                <TabsContent value="overview" className="mt-4 space-y-4">
                  {/* Behavior Score */}
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-medium">Behavior Score</h4>
                        <span className="text-3xl font-bold">{selectedStudent.behaviorScore}/100</span>
                      </div>
                      <Progress value={selectedStudent.behaviorScore} className="h-3" />
                      <p className="text-sm text-gray-600 mt-2">
                        {getBehaviorLevel(selectedStudent.behaviorScore).level} - 
                        {selectedStudent.behaviorScore >= 75 
                          ? " No major concerns detected"
                          : selectedStudent.behaviorScore >= 50
                          ? " Some suspicious activities, review recommended"
                          : " Multiple violations, manual review required"
                        }
                      </p>
                    </CardContent>
                  </Card>
                  
                  {/* Latest Camera View */}
                  {selectedStudent.latestSnapshot?.snapshotUrl && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Latest Camera View</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <img 
                          src={selectedStudent.latestSnapshot.snapshotUrl}
                          alt="Latest snapshot"
                          className="w-full max-w-md mx-auto rounded-lg"
                        />
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Recent Alerts */}
                  {selectedStudent.alertReasons.length > 0 && (
                    <Card className="border-red-200">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-red-700 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Recent Alerts
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {selectedStudent.alertReasons.map((reason, idx) => (
                            <li key={idx} className="text-sm text-red-600 flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 flex-shrink-0" />
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                
                <TabsContent value="events" className="mt-4">
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {studentEvents.length === 0 ? (
                        <p className="text-center text-gray-500 py-8">No events recorded</p>
                      ) : (
                        studentEvents.map((event, idx) => (
                          <Card key={idx} className={`${
                            event.severity === 'critical' ? 'border-red-300 bg-red-50' :
                            event.severity === 'high' ? 'border-orange-300 bg-orange-50' :
                            ''
                          }`}>
                            <CardContent className="py-3">
                              <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${
                                  event.severity === 'critical' ? 'bg-red-200' :
                                  event.severity === 'high' ? 'bg-orange-200' :
                                  event.severity === 'medium' ? 'bg-yellow-200' :
                                  'bg-gray-200'
                                }`}>
                                  {getEventIcon(event.eventType)}
                                </div>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{event.message}</p>
                                  <p className="text-xs text-gray-500">
                                    {new Date(event.timestamp).toLocaleTimeString()} - Penalty: -{event.penalty}
                                  </p>
                                </div>
                                <Badge variant="outline" className={
                                  event.severity === 'critical' ? 'border-red-500 text-red-700' :
                                  event.severity === 'high' ? 'border-orange-500 text-orange-700' :
                                  event.severity === 'medium' ? 'border-yellow-500 text-yellow-700' :
                                  'border-gray-300'
                                }>
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
                        No snapshots available
                      </p>
                    ) : (
                      studentSnapshots.map((snapshot, idx) => (
                        <div key={idx} className="relative aspect-video bg-gray-100 rounded overflow-hidden">
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
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1">
                            <p className="text-xs text-white">
                              {new Date(snapshot.timestamp).toLocaleTimeString()}
                            </p>
                          </div>
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
