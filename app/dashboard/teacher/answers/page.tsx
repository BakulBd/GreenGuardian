"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bot,
  Copy,
  Users,
  Eye,
  BarChart,
  Loader2,
  Download,
  RefreshCcw
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { doc, getDoc, collection, query, where, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { getSimilarityLevel, getSimilarityColor, SIMILARITY_THRESHOLDS } from "@/lib/utils/similarity";
import { analyzeSubmittedAnswer } from "@/lib/utils/gemini";
import { formatDate } from "@/lib/utils/helpers";

interface Answer {
  id: string;
  examId: string;
  sessionId: string;
  studentId: string;
  submittedAt: any;
  autoSubmitted: boolean;
  behaviorScore?: number;
  answerFiles?: Array<{
    name: string;
    downloadURL: string;
    type: string;
  }>;
  ocrAnalysis?: {
    extractedText?: string;
    wordCount?: number;
    aiDetection?: {
      isAIGenerated: boolean;
      confidence: number;
      indicators: string[];
    };
    error?: string;
    analyzedAt?: string;
  };
  answers?: Record<string, string>;
  similarityScore?: number;
  similarityMatches?: Array<{
    studentId: string;
    studentName?: string;
    score: number;
  }>;
}

interface Student {
  id: string;
  name: string;
  email: string;
}

interface Exam {
  id: string;
  title: string;
  examMode: string;
}

// Main component that uses search params
function AnswerReviewContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const examId = searchParams.get("examId");

  const [exam, setExam] = useState<Exam | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [students, setStudents] = useState<Map<string, Student>>(new Map());
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (examId && user) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [examId, user]);

  const loadData = async () => {
    try {
      // Load exam details
      const examDoc = await getDoc(doc(db, "exams", examId!));
      if (!examDoc.exists()) {
        toast({ title: "Error", description: "Exam not found", variant: "destructive" });
        return;
      }
      const examData = { id: examDoc.id, ...examDoc.data() } as Exam;
      setExam(examData);

      // Load answers for this exam
      const answersQuery = query(
        collection(db, "answers"),
        where("examId", "==", examId)
      );
      const answersSnapshot = await getDocs(answersQuery);
      const answersData = answersSnapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Answer[];
      setAnswers(answersData);

      // Load student info
      const studentIds = [...new Set(answersData.map(a => a.studentId))];
      const studentsMap = new Map<string, Student>();
      
      for (const studentId of studentIds) {
        try {
          const studentDoc = await getDoc(doc(db, "users", studentId));
          if (studentDoc.exists()) {
            studentsMap.set(studentId, {
              id: studentId,
              name: studentDoc.data().name || "Unknown",
              email: studentDoc.data().email || "",
            });
          }
        } catch (e) {
          console.error("Error loading student:", e);
        }
      }
      setStudents(studentsMap);
    } catch (error) {
      console.error("Error loading data:", error);
      toast({ title: "Error", description: "Failed to load answers", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const runOCRAnalysis = async (answer: Answer) => {
    if (!answer.answerFiles || answer.answerFiles.length === 0) {
      toast({ title: "Error", description: "No files to analyze", variant: "destructive" });
      return;
    }

    setAnalyzing(answer.id);
    try {
      const fileUrl = answer.answerFiles[0].downloadURL;
      const analysis = await analyzeSubmittedAnswer(fileUrl);

      // Update the answer in Firestore
      await updateDoc(doc(db, "answers", answer.id), {
        ocrAnalysis: {
          extractedText: analysis.extractedText.substring(0, 10000),
          wordCount: analysis.wordCount,
          aiDetection: analysis.aiDetection,
          errors: analysis.errors,
          analyzedAt: new Date().toISOString(),
        },
      });

      // Update local state
      setAnswers(prev => prev.map(a => 
        a.id === answer.id 
          ? { ...a, ocrAnalysis: { ...analysis, analyzedAt: new Date().toISOString() } }
          : a
      ));

      toast({ title: "Success", description: "Analysis complete" });
    } catch (error: any) {
      console.error("OCR analysis error:", error);
      toast({ title: "Error", description: error.message || "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzing(null);
    }
  };

  const runSimilarityCheck = async () => {
    if (answers.length < 2) {
      toast({ title: "Info", description: "Need at least 2 answers for comparison" });
      return;
    }

    // Extract text from all answers that have OCR data
    const answersWithText = answers.filter(a => a.ocrAnalysis?.extractedText);
    
    if (answersWithText.length < 2) {
      toast({ 
        title: "Run OCR First", 
        description: "Please analyze answers with OCR before running similarity check",
        variant: "destructive" 
      });
      return;
    }

    toast({ title: "Processing", description: "Running similarity analysis..." });

    try {
      // Simple cross-comparison using Jaccard similarity
      const updatedAnswers = [...answers];
      
      for (let i = 0; i < answersWithText.length; i++) {
        const answer1 = answersWithText[i];
        const text1 = answer1.ocrAnalysis!.extractedText!.toLowerCase();
        const matches: Answer["similarityMatches"] = [];
        let maxScore = 0;

        for (let j = 0; j < answersWithText.length; j++) {
          if (i === j) continue;
          
          const answer2 = answersWithText[j];
          const text2 = answer2.ocrAnalysis!.extractedText!.toLowerCase();
          
          // Simple word overlap calculation
          const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 3));
          const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 3));
          
          let overlap = 0;
          words1.forEach(w => { if (words2.has(w)) overlap++; });
          
          const score = Math.round((overlap / Math.min(words1.size, words2.size)) * 100);
          
          if (score > 20) {
            matches.push({
              studentId: answer2.studentId,
              studentName: students.get(answer2.studentId)?.name,
              score,
            });
            maxScore = Math.max(maxScore, score);
          }
        }

        // Update Firestore
        const answerIndex = updatedAnswers.findIndex(a => a.id === answer1.id);
        if (answerIndex !== -1) {
          updatedAnswers[answerIndex] = {
            ...updatedAnswers[answerIndex],
            similarityScore: maxScore,
            similarityMatches: matches.sort((a, b) => b.score - a.score),
          };

          await updateDoc(doc(db, "answers", answer1.id), {
            similarityScore: maxScore,
            similarityMatches: matches,
          });
        }
      }

      setAnswers(updatedAnswers);
      toast({ title: "Success", description: "Similarity analysis complete" });
    } catch (error: any) {
      console.error("Similarity check error:", error);
      toast({ title: "Error", description: error.message || "Similarity check failed", variant: "destructive" });
    }
  };

  const getAIBadge = (aiDetection?: {
    isAIGenerated: boolean;
    confidence: number;
    indicators: string[];
  }) => {
    if (!aiDetection) return null;
    
    const { isAIGenerated, confidence } = aiDetection;
    
    if (isAIGenerated && confidence >= 70) {
      return <Badge className="bg-red-100 text-red-700">AI Detected ({confidence}%)</Badge>;
    } else if (isAIGenerated && confidence >= 40) {
      return <Badge className="bg-yellow-100 text-yellow-700">Possibly AI ({confidence}%)</Badge>;
    }
    return <Badge className="bg-green-100 text-green-700">Likely Human ({100 - confidence}%)</Badge>;
  };

  const getSimilarityBadge = (score?: number) => {
    if (score === undefined) return null;
    
    const level = getSimilarityLevel(score);
    const colors = getSimilarityColor(level);
    
    return (
      <Badge className={`${colors.bg} ${colors.text}`}>
        {level === "plagiarized" ? "High Similarity" : 
         level === "partial" ? "Some Similarity" : "Unique"} ({score}%)
      </Badge>
    );
  };

  if (loading) {
    return (
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!examId || !exam) {
    return (
      <DashboardLayout role="teacher">
        <div className="text-center py-12">
          <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Exam Selected</h3>
          <p className="text-gray-600 mb-4">Please select an exam to review answers</p>
          <Link href="/dashboard/teacher/exams">
            <Button>Go to Exams</Button>
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="teacher">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard/teacher/exams">
              <Button variant="outline" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{exam.title}</h1>
              <p className="text-gray-600">Answer Review & Analysis</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={runSimilarityCheck}>
              <Copy className="h-4 w-4 mr-2" />
              Run Similarity Check
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <FileText className="h-6 w-6 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Total Answers</p>
                  <p className="text-2xl font-bold">{answers.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">Analyzed</p>
                  <p className="text-2xl font-bold">
                    {answers.filter(a => a.ocrAnalysis?.extractedText).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <Bot className="h-6 w-6 text-yellow-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">AI Detected</p>
                  <p className="text-2xl font-bold">
                    {answers.filter(a => a.ocrAnalysis?.aiDetection?.isAIGenerated).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center">
                <AlertTriangle className="h-6 w-6 text-red-600" />
                <div className="ml-4">
                  <p className="text-sm text-gray-600">High Similarity</p>
                  <p className="text-2xl font-bold">
                    {answers.filter(a => (a.similarityScore || 0) >= SIMILARITY_THRESHOLDS.PLAGIARIZED).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Answers List */}
        <Card>
          <CardHeader>
            <CardTitle>Student Answers</CardTitle>
            <CardDescription>
              Click on an answer to see detailed analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            {answers.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900">No Answers Yet</h3>
                <p className="text-gray-600">Students haven't submitted answers yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {answers.map((answer) => {
                  const student = students.get(answer.studentId);
                  return (
                    <div
                      key={answer.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors hover:bg-gray-50 ${
                        selectedAnswer?.id === answer.id ? "border-primary-500 bg-primary-50" : ""
                      }`}
                      onClick={() => setSelectedAnswer(answer)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                            <span className="text-primary-600 font-medium">
                              {(student?.name || "S").charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">
                              {student?.name || `Student ${answer.studentId.slice(0, 8)}`}
                            </p>
                            <p className="text-sm text-gray-600">
                              Submitted: {answer.submittedAt?.toDate?.()?.toLocaleDateString() || "Unknown"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {answer.behaviorScore !== undefined && (
                            <Badge variant="outline">
                              Behavior: {answer.behaviorScore}%
                            </Badge>
                          )}
                          {getAIBadge(answer.ocrAnalysis?.aiDetection)}
                          {getSimilarityBadge(answer.similarityScore)}
                          {!answer.ocrAnalysis?.extractedText && (answer.answerFiles?.length ?? 0) > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                runOCRAnalysis(answer);
                              }}
                              disabled={analyzing === answer.id}
                            >
                              {analyzing === answer.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <RefreshCcw className="h-4 w-4 mr-1" />
                                  Analyze
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Selected Answer Details */}
        {selectedAnswer && (
          <Card className="border-primary-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Answer Details</CardTitle>
                <Button variant="ghost" onClick={() => setSelectedAnswer(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="ai-detection">AI Detection</TabsTrigger>
                  <TabsTrigger value="similarity">Similarity</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Student</p>
                      <p className="font-medium">
                        {students.get(selectedAnswer.studentId)?.name || "Unknown"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Behavior Score</p>
                      <p className="font-medium">{selectedAnswer.behaviorScore ?? "-"}%</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Word Count</p>
                      <p className="font-medium">
                        {selectedAnswer.ocrAnalysis?.wordCount ?? "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Files Uploaded</p>
                      <p className="font-medium">
                        {selectedAnswer.answerFiles?.length || 0}
                      </p>
                    </div>
                  </div>
                  {selectedAnswer.answerFiles && selectedAnswer.answerFiles.length > 0 && (
                    <div>
                      <p className="text-sm text-gray-600 mb-2">Uploaded Files</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedAnswer.answerFiles.map((file, i) => (
                          <a
                            key={i}
                            href={file.downloadURL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            <span className="text-sm">{file.name}</span>
                            <Download className="h-4 w-4 ml-2" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="content" className="mt-4">
                  {selectedAnswer.ocrAnalysis?.extractedText ? (
                    <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                      <pre className="whitespace-pre-wrap text-sm">
                        {selectedAnswer.ocrAnalysis.extractedText}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-gray-600 mb-4">Content not yet extracted</p>
                      {(selectedAnswer.answerFiles?.length ?? 0) > 0 && (
                        <Button onClick={() => runOCRAnalysis(selectedAnswer)}>
                          Run OCR Analysis
                        </Button>
                      )}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="ai-detection" className="mt-4">
                  {selectedAnswer.ocrAnalysis?.aiDetection ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">AI Generated Content</p>
                          <p className="text-sm text-gray-600">
                            {selectedAnswer.ocrAnalysis.aiDetection.isAIGenerated
                              ? "This content shows signs of AI generation"
                              : "This content appears to be human-written"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-bold">
                            {selectedAnswer.ocrAnalysis.aiDetection.confidence}%
                          </p>
                          <p className="text-sm text-gray-600">Confidence</p>
                        </div>
                      </div>
                      <Progress 
                        value={selectedAnswer.ocrAnalysis.aiDetection.confidence} 
                        className={
                          selectedAnswer.ocrAnalysis.aiDetection.confidence >= 70 ? "text-red-600" :
                          selectedAnswer.ocrAnalysis.aiDetection.confidence >= 40 ? "text-yellow-600" :
                          "text-green-600"
                        }
                      />
                      {selectedAnswer.ocrAnalysis.aiDetection.indicators.length > 0 && (
                        <div>
                          <p className="font-medium mb-2">Indicators Found:</p>
                          <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                            {selectedAnswer.ocrAnalysis.aiDetection.indicators.map((indicator, i) => (
                              <li key={i}>{indicator}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Bot className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">AI detection not yet run</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="similarity" className="mt-4">
                  {selectedAnswer.similarityScore !== undefined ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium">Similarity Score</p>
                          <p className="text-sm text-gray-600">
                            Compared against other student submissions
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-bold">
                            {selectedAnswer.similarityScore}%
                          </p>
                          {getSimilarityBadge(selectedAnswer.similarityScore)}
                        </div>
                      </div>
                      {selectedAnswer.similarityMatches && selectedAnswer.similarityMatches.length > 0 && (
                        <div>
                          <p className="font-medium mb-2">Similar Submissions:</p>
                          <div className="space-y-2">
                            {selectedAnswer.similarityMatches.map((match, i) => (
                              <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                                <span>{match.studentName || `Student ${match.studentId.slice(0, 8)}`}</span>
                                <Badge className={
                                  match.score >= 70 ? "bg-red-100 text-red-700" :
                                  match.score >= 30 ? "bg-yellow-100 text-yellow-700" :
                                  "bg-green-100 text-green-700"
                                }>
                                  {match.score}% match
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">Similarity check not yet run</p>
                      <Button className="mt-4" onClick={runSimilarityCheck}>
                        Run Similarity Check
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}

// Wrapper component with Suspense boundary
export default function AnswerReviewPage() {
  return (
    <Suspense fallback={
      <DashboardLayout role="teacher">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </DashboardLayout>
    }>
      <AnswerReviewContent />
    </Suspense>
  );
}
