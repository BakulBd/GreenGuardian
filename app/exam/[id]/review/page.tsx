"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Shield,
  Monitor
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface Question {
  id: string;
  text: string;
  type: string;
  options?: string[];
  correctAnswer?: string;
  marks: number;
}

interface Exam {
  id: string;
  title: string;
  description: string;
  duration: number;
  questions?: Question[];
  settings?: any;
  showResults?: boolean;
}

export default function ExamReviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [exam, setExam] = useState<Exam | null>(null);
  const [answerData, setAnswerData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const examId = params.id as string;

  useEffect(() => {
    if (examId && user) {
      loadReviewData();
    }
  }, [examId, user]);

  const loadReviewData = async () => {
    try {
      // Load exam
      const examDoc = await getDoc(doc(db, "exams", examId));
      if (!examDoc.exists()) {
        throw new Error("Exam not found");
      }
      const examData = { id: examDoc.id, ...examDoc.data() } as Exam;
      setExam(examData);

      // Check if review is allowed
      if (!examData.settings?.allowReview && !examData.showResults && examData.settings?.showResults === false) {
        toast({
          title: "Review Not Available",
          description: "The teacher has disabled reviews for this exam.",
          variant: "destructive"
        });
        router.push("/dashboard/student");
        return;
      }

      // Load user's answer
      const answersQuery = query(
        collection(db, "answers"),
        where("examId", "==", examId),
        where("studentId", "==", user!.id)
      );
      const answerSnapshot = await getDocs(answersQuery);
      
      if (answerSnapshot.empty) {
        toast({
          title: "Not Found",
          description: "No submission found for this exam.",
          variant: "destructive"
        });
        router.push("/dashboard/student");
        return;
      }
      
      setAnswerData(answerSnapshot.docs[0].data());
    } catch (error) {
      console.error("Error loading review:", error);
      toast({
        title: "Error",
        description: "Failed to load exam review",
        variant: "destructive",
      });
      router.push("/dashboard/student");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!exam || !answerData) {
    return null;
  }

  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center space-x-3 mb-6">
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/student")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Exam Review</h1>
            <p className="text-sm text-gray-500">{exam.title}</p>
          </div>
        </div>

        {/* Summary Card */}
        <Card className="border-t-4 border-t-blue-500 shadow-md">
          <CardHeader className="bg-blue-50/50 pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-xl text-blue-900">Performance Summary</CardTitle>
                <CardDescription>
                  Submitted on {answerData.submittedAt?.toDate?.()?.toLocaleString() || 'Unknown'}
                </CardDescription>
              </div>
              <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 px-3 py-1">
                Score: {answerData.score ?? 0} / {answerData.totalMarks ?? 100}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="p-4 bg-gray-50 rounded-lg border">
                <p className="text-sm text-gray-500 mb-1">Accuracy</p>
                <p className="text-2xl font-bold text-gray-900">{answerData.accuracy ?? 0}%</p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
                <p className="text-sm text-emerald-600 mb-1 flex items-center justify-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Correct
                </p>
                <p className="text-2xl font-bold text-emerald-700">{answerData.grading?.correctAnswers ?? 0}</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                <p className="text-sm text-red-600 mb-1 flex items-center justify-center gap-1">
                  <XCircle className="w-4 h-4" /> Wrong
                </p>
                <p className="text-2xl font-bold text-red-700">{answerData.grading?.wrongAnswers ?? 0}</p>
              </div>
              <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-sm text-amber-600 mb-1 flex items-center justify-center gap-1">
                  <Shield className="w-4 h-4" /> Behavior
                </p>
                <p className="text-2xl font-bold text-amber-700">{answerData.behaviorScore ?? 100}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Proctoring Warnings Summary if any */}
        {answerData.warningCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-amber-900">Proctoring Alerts Logged</h3>
              <p className="text-sm text-amber-700 mt-1">
                You received {answerData.warningCount} warning(s) during this exam, which resulted in a behavior score of {answerData.behaviorScore}. 
                {answerData.flagged && " This exam was flagged for review by your teacher."}
              </p>
            </div>
          </div>
        )}

        {/* Questions and Answers */}
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            Detailed Review
          </h2>
          
          {exam.questions && exam.questions.length > 0 ? (
            exam.questions.map((q, idx) => {
              const studentAnswer = answerData.answers?.[q.id] || "";
              const isCorrect = normalize(studentAnswer) === normalize(q.correctAnswer);
              const isUnanswered = !studentAnswer || studentAnswer.trim() === "";

              return (
                <Card key={q.id} className={`overflow-hidden border-l-4 ${isCorrect ? 'border-l-emerald-500' : isUnanswered ? 'border-l-gray-300' : 'border-l-red-500'}`}>
                  <CardHeader className="bg-gray-50/50 pb-3">
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-semibold">Question {idx + 1}</Badge>
                          <Badge className="bg-slate-100 text-slate-600 border-slate-200 capitalize">{q.type}</Badge>
                          <span className="text-xs font-medium text-gray-500">{q.marks} Marks</span>
                        </div>
                        <p className="text-gray-900 font-medium text-lg leading-relaxed">{q.text}</p>
                      </div>
                      
                      {isCorrect ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Correct
                        </Badge>
                      ) : isUnanswered ? (
                        <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 border-gray-200 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Unanswered
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 hover:bg-red-200 border-red-200 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> Incorrect
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    
                    {/* Multiple Choice Options Display */}
                    {q.type === 'multiple-choice' && q.options && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        {q.options.map((opt, i) => {
                          const isSelected = normalize(studentAnswer) === normalize(opt);
                          const isActualCorrect = normalize(q.correctAnswer) === normalize(opt);
                          
                          let bgClass = "bg-gray-50 border-gray-200 text-gray-700";
                          let icon = null;
                          
                          if (isSelected && isActualCorrect) {
                            bgClass = "bg-emerald-50 border-emerald-500 text-emerald-900 font-medium shadow-sm";
                            icon = <CheckCircle className="w-4 h-4 text-emerald-600" />;
                          } else if (isSelected && !isActualCorrect) {
                            bgClass = "bg-red-50 border-red-300 text-red-900 font-medium";
                            icon = <XCircle className="w-4 h-4 text-red-500" />;
                          } else if (!isSelected && isActualCorrect) {
                            bgClass = "bg-emerald-50/50 border-emerald-300 border-dashed text-emerald-800";
                            icon = <CheckCircle className="w-4 h-4 text-emerald-500 opacity-60" />;
                          }

                          return (
                            <div key={i} className={`p-3 rounded-lg border flex items-center justify-between ${bgClass} transition-colors`}>
                              <span className="text-sm">{opt}</span>
                              {icon}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Short Answer / True False Display */}
                    {q.type !== 'multiple-choice' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                        <div className={`p-4 rounded-lg border ${isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Your Answer</p>
                          <p className={`font-medium ${!studentAnswer ? 'text-gray-400 italic' : 'text-gray-900'}`}>
                            {studentAnswer || "No answer provided"}
                          </p>
                        </div>
                        
                        <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">Correct Answer</p>
                          <p className="font-medium text-blue-900">
                            {q.correctAnswer}
                          </p>
                        </div>
                      </div>
                    )}
                    
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="text-center py-12 text-gray-500">
                <Monitor className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                <p>No question details available for this exam.</p>
              </CardContent>
            </Card>
          )}
        </div>
        
      </div>
    </div>
  );
}
