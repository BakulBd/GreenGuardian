"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  ArrowLeft,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Eye,
  Smartphone,
  BookOpen,
  Laptop,
  UserPlus,
  Users,
  Monitor,
  Clock,
  TrendingDown,
  TrendingUp,
  CheckCircle,
  XCircle,
  ClipboardList,
  Camera,
  History,
  PieChart,
  BarChart3,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc, collection, query, where, getDocs, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getBehaviorLevel, getViolationSummary, ViolationCounts } from "@/lib/utils/helpers";
import Link from "next/link";

interface SessionResult {
  id: string;
  examId: string;
  examTitle: string;
  studentId: string;
  studentName: string;
  startTime: Date;
  endTime?: Date;
  status: string;
  behaviorScore: number;
  warningCount: number;
  violationCounts: ViolationCounts;
  autoSubmitted: boolean;
  flagged: boolean;
  proctoring?: {
    tabSwitches: number;
    fullscreenExits: number;
    noFaceDuration: number;
    multipleFacesCount: number;
    suspiciousEvents: number;
    eventCounts?: Record<string, number>;
  };
}

interface ProctoringEvent {
  id: string;
  sessionId: string;
  eventType: string;
  message: string;
  severity: string;
  penalty: number;
  timestamp: Date;
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [session, setSession] = useState<SessionResult | null>(null);
  const [events, setEvents] = useState<ProctoringEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEventsDialog, setShowEventsDialog] = useState(false);
  
  useEffect(() => {
    if (sessionId) {
      loadSessionData();
    }
  }, [sessionId]);
  
  const loadSessionData = async () => {
    if (!sessionId) return;
    
    try {
      // Get session data
      const sessionDoc = await getDoc(doc(db, "examSessions", sessionId));
      if (!sessionDoc.exists()) {
        toast({
          title: "Not Found",
          description: "Session not found",
          variant: "destructive"
        });
        return;
      }
      
      const data = sessionDoc.data();
      
      // Get exam title
      let examTitle = "Unknown Exam";
      if (data.examId) {
        const examDoc = await getDoc(doc(db, "exams", data.examId));
        if (examDoc.exists()) {
          examTitle = examDoc.data().title;
        }
      }
      
      const result: SessionResult = {
        id: sessionDoc.id,
        examId: data.examId,
        examTitle,
        studentId: data.studentId,
        studentName: data.studentName || "Unknown",
        startTime: data.startTime?.toDate() || new Date(),
        endTime: data.completedAt?.toDate(),
        status: data.status,
        behaviorScore: data.behaviorScore ?? 100,
        warningCount: data.warnings || 0,
        violationCounts: data.violationCounts || {
          tabSwitch: 0,
          fullscreenExit: 0,
          noFace: 0,
          multipleFaces: 0,
          lookingAway: 0,
          copyAttempt: 0,
          pasteAttempt: 0,
          rightClick: 0,
          suspiciousKeyboard: 0,
          windowBlur: 0,
          multipleWindows: 0,
          mobilePhoneDetected: 0,
          bookDetected: 0,
          additionalDevice: 0,
          secondPerson: 0,
        },
        autoSubmitted: data.autoSubmitted || false,
        flagged: data.flagged || false,
        proctoring: data.proctoring,
      };
      
      setSession(result);
      
      // Load proctoring events
      const eventsQuery = query(
        collection(db, "proctoringEvents"),
        where("sessionId", "==", sessionId),
        orderBy("timestamp", "desc")
      );
      
      try {
        const eventsSnap = await getDocs(eventsQuery);
        const eventsList = eventsSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          timestamp: doc.data().timestamp?.toDate() || new Date(),
        })) as ProctoringEvent[];
        setEvents(eventsList);
      } catch (e) {
        console.log("No proctoring events found");
      }
      
    } catch (error) {
      console.error("Error loading session:", error);
      toast({
        title: "Error",
        description: "Failed to load session data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };
  
  const getViolationIcon = (type: string) => {
    switch (type) {
      case 'mobilePhoneDetected': return <Smartphone className="h-4 w-4" />;
      case 'bookDetected': return <BookOpen className="h-4 w-4" />;
      case 'additionalDevice': return <Laptop className="h-4 w-4" />;
      case 'secondPerson': return <UserPlus className="h-4 w-4" />;
      case 'multipleFaces': return <Users className="h-4 w-4" />;
      case 'noFace': return <XCircle className="h-4 w-4" />;
      case 'lookingAway': return <Eye className="h-4 w-4" />;
      case 'tabSwitch': return <Monitor className="h-4 w-4" />;
      case 'fullscreenExit': return <Monitor className="h-4 w-4" />;
      default: return <AlertTriangle className="h-4 w-4" />;
    }
  };
  
  const getViolationColor = (type: string) => {
    const critical = ['mobilePhoneDetected', 'secondPerson', 'multipleWindows'];
    const high = ['bookDetected', 'additionalDevice', 'multipleFaces'];
    const medium = ['tabSwitch', 'fullscreenExit', 'copyAttempt', 'pasteAttempt', 'noFace'];
    
    if (critical.includes(type)) return 'bg-red-100 text-red-800 border-red-200';
    if (high.includes(type)) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (medium.includes(type)) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };
  
  const getViolationLabel = (type: string) => {
    const labels: Record<string, string> = {
      tabSwitch: 'Tab Switches',
      fullscreenExit: 'Fullscreen Exits',
      noFace: 'Face Not Visible',
      multipleFaces: 'Multiple Faces',
      lookingAway: 'Looking Away',
      copyAttempt: 'Copy Attempts',
      pasteAttempt: 'Paste Attempts',
      rightClick: 'Right Click',
      suspiciousKeyboard: 'Suspicious Keys',
      windowBlur: 'Window Lost Focus',
      multipleWindows: 'Multiple Windows',
      mobilePhoneDetected: 'Mobile Phone',
      bookDetected: 'Books/Materials',
      additionalDevice: 'Additional Device',
      secondPerson: 'Second Person',
    };
    return labels[type] || type;
  };
  
  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
        </div>
      </DashboardLayout>
    );
  }
  
  if (!session) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <ShieldAlert className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Session Not Found</h2>
          <p className="text-gray-600 mb-4">The requested exam session could not be found.</p>
          <Link href="/dashboard/teacher/students">
            <Button>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Students
            </Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }
  
  const behaviorLevel = getBehaviorLevel(session.behaviorScore);
  const violationSummary = getViolationSummary(session.violationCounts);
  
  // Calculate violation statistics
  const violationStats = Object.entries(session.violationCounts)
    .filter(([_, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  
  const totalViolations = Object.values(session.violationCounts).reduce((a, b) => a + b, 0);
  
  // Determine critical violations
  const criticalViolations = [
    session.violationCounts.mobilePhoneDetected,
    session.violationCounts.secondPerson,
    session.violationCounts.multipleWindows,
    session.violationCounts.bookDetected,
    session.violationCounts.additionalDevice,
  ].reduce((a, b) => a + b, 0);
  
  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/teacher/students">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                Behavior Analysis
              </h1>
              <p className="text-sm text-gray-600">{session.examTitle}</p>
            </div>
          </div>
          
          {/* Overall Score Badge */}
          <Card className={`${session.flagged ? 'border-red-300 bg-red-50' : ''}`}>
            <CardContent className="p-4 flex items-center gap-4">
              {session.behaviorScore >= 75 ? (
                <ShieldCheck className="h-10 w-10 text-green-600" />
              ) : session.behaviorScore >= 50 ? (
                <Shield className="h-10 w-10 text-yellow-600" />
              ) : (
                <ShieldAlert className="h-10 w-10 text-red-600" />
              )}
              <div>
                <p className="text-sm text-gray-600">Behavior Score</p>
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold">{session.behaviorScore}</span>
                  <Badge className={behaviorLevel.badge}>{behaviorLevel.level}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Student Info */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600">Student</p>
                <p className="font-medium">{session.studentName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Started</p>
                <p className="font-medium">{session.startTime.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Status</p>
                <Badge variant={session.autoSubmitted ? "destructive" : "default"}>
                  {session.autoSubmitted ? "Auto-Submitted" : session.status}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Warnings</p>
                <p className="font-medium text-orange-600">{session.warningCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Score Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Behavior Score Visualization */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="h-5 w-5" />
                Behavior Score Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Score Gauge */}
                <div className="text-center">
                  <div className="relative w-48 h-48 mx-auto">
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                      {/* Background circle */}
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="#e5e7eb"
                        strokeWidth="10"
                      />
                      {/* Score arc */}
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke={
                          session.behaviorScore >= 75 ? "#22c55e" :
                          session.behaviorScore >= 50 ? "#eab308" :
                          session.behaviorScore >= 25 ? "#f97316" :
                          "#ef4444"
                        }
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${session.behaviorScore * 2.83} 283`}
                        transform="rotate(-90 50 50)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-4xl font-bold">{session.behaviorScore}</span>
                      <span className="text-sm text-gray-500">out of 100</span>
                    </div>
                  </div>
                </div>
                
                {/* Score Interpretation */}
                <div className={`p-4 rounded-lg ${
                  session.behaviorScore >= 75 ? 'bg-green-50 text-green-800' :
                  session.behaviorScore >= 50 ? 'bg-yellow-50 text-yellow-800' :
                  session.behaviorScore >= 25 ? 'bg-orange-50 text-orange-800' :
                  'bg-red-50 text-red-800'
                }`}>
                  <p className="font-medium">
                    {session.behaviorScore >= 90 ? "Excellent exam behavior - No significant concerns" :
                     session.behaviorScore >= 75 ? "Good behavior with minor concerns" :
                     session.behaviorScore >= 50 ? "Several suspicious activities detected - Review recommended" :
                     session.behaviorScore >= 25 ? "Multiple violations - Manual review required" :
                     "Critical violations detected - Possible cheating attempt"}
                  </p>
                </div>
                
                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-50 rounded-lg text-center">
                    <p className="text-2xl font-bold">{totalViolations}</p>
                    <p className="text-sm text-gray-600">Total Violations</p>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${criticalViolations > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                    <p className="text-2xl font-bold">{criticalViolations}</p>
                    <p className="text-sm text-gray-600">Critical Violations</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Violations Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Violation Breakdown
              </CardTitle>
              <CardDescription>
                Detailed view of all detected violations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[350px]">
                {violationStats.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <p className="text-green-700 font-medium">No violations detected</p>
                    <p className="text-sm text-gray-500">This student maintained excellent exam behavior</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {violationStats.map(([type, count]) => (
                      <div 
                        key={type} 
                        className={`p-3 rounded-lg border ${getViolationColor(type)}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getViolationIcon(type)}
                            <span className="font-medium">{getViolationLabel(type)}</span>
                          </div>
                          <Badge variant="secondary" className="font-bold">
                            ×{count}
                          </Badge>
                        </div>
                        <div className="mt-2">
                          <Progress 
                            value={(count / Math.max(...violationStats.map(v => v[1]))) * 100} 
                            className="h-2"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
              
              {events.length > 0 && (
                <Button 
                  variant="outline" 
                  className="w-full mt-4"
                  onClick={() => setShowEventsDialog(true)}
                >
                  <History className="h-4 w-4 mr-2" />
                  View Event Timeline ({events.length} events)
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Violation Summary Cards */}
        {criticalViolations > 0 && (
          <Card className="border-red-300 bg-red-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <ShieldAlert className="h-5 w-5" />
                Critical Violations Detected
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {session.violationCounts.mobilePhoneDetected > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-red-200">
                    <Smartphone className="h-8 w-8 text-red-600" />
                    <div>
                      <p className="font-medium text-red-800">Mobile Phone</p>
                      <p className="text-sm text-red-600">Detected {session.violationCounts.mobilePhoneDetected} time(s)</p>
                    </div>
                  </div>
                )}
                {session.violationCounts.secondPerson > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-red-200">
                    <UserPlus className="h-8 w-8 text-red-600" />
                    <div>
                      <p className="font-medium text-red-800">Second Person</p>
                      <p className="text-sm text-red-600">Detected {session.violationCounts.secondPerson} time(s)</p>
                    </div>
                  </div>
                )}
                {session.violationCounts.bookDetected > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-orange-200">
                    <BookOpen className="h-8 w-8 text-orange-600" />
                    <div>
                      <p className="font-medium text-orange-800">Study Material</p>
                      <p className="text-sm text-orange-600">Detected {session.violationCounts.bookDetected} time(s)</p>
                    </div>
                  </div>
                )}
                {session.violationCounts.additionalDevice > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-orange-200">
                    <Laptop className="h-8 w-8 text-orange-600" />
                    <div>
                      <p className="font-medium text-orange-800">Additional Device</p>
                      <p className="text-sm text-orange-600">Detected {session.violationCounts.additionalDevice} time(s)</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Teacher Recommendation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`p-4 rounded-lg ${
              session.behaviorScore >= 75 ? 'bg-green-50 border border-green-200' :
              session.behaviorScore >= 50 ? 'bg-yellow-50 border border-yellow-200' :
              'bg-red-50 border border-red-200'
            }`}>
              {session.behaviorScore >= 75 ? (
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-green-800">Accept Submission</p>
                    <p className="text-sm text-green-700 mt-1">
                      This student demonstrated good exam behavior. The submission can be accepted with confidence.
                    </p>
                  </div>
                </div>
              ) : session.behaviorScore >= 50 ? (
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-yellow-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-800">Review Required</p>
                    <p className="text-sm text-yellow-700 mt-1">
                      Some suspicious activities were detected. Consider reviewing the answer quality 
                      and comparing with other submissions before making a final decision.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-red-800">Manual Review Required</p>
                    <p className="text-sm text-red-700 mt-1">
                      Multiple serious violations were detected during this exam session. 
                      A thorough manual review is recommended before accepting this submission.
                      Consider contacting the student for an explanation.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Events Timeline Dialog */}
      <Dialog open={showEventsDialog} onOpenChange={setShowEventsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Event Timeline</DialogTitle>
            <DialogDescription>
              Chronological list of all proctoring events
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px] mt-4">
            <div className="space-y-3">
              {events.map((event) => (
                <div 
                  key={event.id}
                  className={`p-3 rounded-lg border ${
                    event.severity === 'critical' ? 'bg-red-50 border-red-200' :
                    event.severity === 'high' ? 'bg-orange-50 border-orange-200' :
                    event.severity === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                    'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-4 w-4 ${
                        event.severity === 'critical' ? 'text-red-600' :
                        event.severity === 'high' ? 'text-orange-600' :
                        event.severity === 'medium' ? 'text-yellow-600' :
                        'text-gray-600'
                      }`} />
                      <span className="font-medium">{event.message}</span>
                    </div>
                    <Badge variant="outline">-{event.penalty} pts</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {event.timestamp.toLocaleTimeString()}
                    </span>
                    <Badge variant="secondary">{event.severity}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

export default function SessionResultsPage() {
  return (
    <Suspense fallback={
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600" />
        </div>
      </DashboardLayout>
    }>
      <ResultsContent />
    </Suspense>
  );
}
