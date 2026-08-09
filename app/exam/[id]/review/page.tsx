"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import ExamAnswerReview, { ReviewExam } from "@/components/ExamAnswerReview";

type Exam = ReviewExam & {
  description?: string;
  duration?: number;
  settings?: any;
  showResults?: boolean;
};

const isSubmittedStatus = (status: string) =>
  status === "submitted" || status === "auto-submitted" || status === "completed";

/** Firestore Timestamp | Date | ISO string -> epoch millis (0 when unknown). */
const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

export default function ExamReviewPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, initialized, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [exam, setExam] = useState<Exam | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [answerData, setAnswerData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const examId = params.id as string;
  const sessionParam = searchParams?.get("session") || null;

  // This page renders outside DashboardLayout, so it must guard itself.
  useEffect(() => {
    if (!initialized || authLoading) return;
    if (!user) {
      router.replace(`/login?next=/exam/${examId}/review${sessionParam ? `?session=${sessionParam}` : ""}`);
    }
  }, [initialized, authLoading, user, router, examId, sessionParam]);

  useEffect(() => {
    if (examId && user) {
      loadReviewData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, user, sessionParam]);

  const loadReviewData = async () => {
    if (!user) return;
    try {
      setLoading(true);

      // The exam doc is best-effort ONLY. A student's own submission must stay
      // reviewable after the teacher archives the exam or changes its target
      // group — both of which revoke read access to the exam document. The
      // authoritative question set comes from the snapshot stored on the
      // answer doc at submit time; the live exam is just nicer metadata.
      let examData: Exam | null = null;
      try {
        const examDoc = await getDoc(doc(db, "exams", examId));
        if (examDoc.exists()) {
          examData = { id: examDoc.id, ...examDoc.data() } as Exam;
          setExam(examData);
        }
      } catch {
        // permission-denied (exam closed/retargeted) — fall back to the snapshot.
      }

      // Review is shown by default; a teacher can explicitly turn it off.
      if (examData?.settings?.allowReview === false) {
        toast({
          title: "Review Not Available",
          description: "The teacher has disabled reviews for this exam.",
          variant: "destructive",
        });
        router.push("/dashboard/student");
        return;
      }

      // Resolve which attempt to review. A specific session id (passed from
      // the dashboard's "Review Answers" button) is authoritative — this
      // matters once an exam allows more than one attempt (see Task 4):
      // without it, an older/different attempt could be shown instead of
      // the one the student actually clicked into.
      let sessionData: any = null;
      if (sessionParam) {
        const sessionDoc = await getDoc(doc(db, "examSessions", sessionParam));
        if (sessionDoc.exists()) {
          const data = { id: sessionDoc.id, ...sessionDoc.data() } as any;
          if (data.studentId === user.id && data.examId === examId) {
            sessionData = data;
          }
        }
      }
      if (!sessionData) {
        const sessionsSnap = await getDocs(
          query(
            collection(db, "examSessions"),
            where("examId", "==", examId),
            where("studentId", "==", user.id)
          )
        );
        const sessions = sessionsSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((s) => isSubmittedStatus(s.status));
        sessionData = sessions.sort((a, b) => toMillis(b.completedAt) - toMillis(a.completedAt))[0] || null;
      }
      setSession(sessionData);

      // Resolve the matching answer document. Every submission written by
      // ExamClient.handleSubmit() carries examSessionId, so once we know the
      // session this lookup is exact — no more guessing across attempts.
      let answerDocData: any = null;
      if (sessionData) {
        // Firestore rules only allow a student to read their own answers
        // (isUser(resource.data.studentId)) — the query must filter on
        // studentId too, or the rules engine can't prove every possible
        // result is theirs and denies the whole query.
        const bySession = await getDocs(
          query(
            collection(db, "answers"),
            where("examSessionId", "==", sessionData.id),
            where("studentId", "==", user.id)
          )
        );
        if (!bySession.empty) {
          answerDocData = { id: bySession.docs[0].id, ...bySession.docs[0].data() };
        }
      }
      if (!answerDocData) {
        // Legacy fallback for answers written before examSessionId was reliably set.
        const byStudent = await getDocs(
          query(collection(db, "answers"), where("studentId", "==", user.id))
        );
        const match = byStudent.docs.find((d) => d.data().examId === examId);
        if (match) {
          answerDocData = { id: match.id, ...match.data() };
        }
      }

      if (!answerDocData) {
        toast({
          title: "Not Found",
          description: "No submission found for this exam.",
          variant: "destructive",
        });
        router.push("/dashboard/student");
        return;
      }

      setAnswerData(answerDocData);

      // The snapshot written by /api/exams/grade is the ONLY source of answer
      // keys here. The live exam document no longer carries `correctAnswer` —
      // it is student-readable, so the key was stripped from it — and reviewing
      // from it would mark every question as having no correct answer.
      const snapshot = Array.isArray(answerDocData.questionSnapshot)
        ? answerDocData.questionSnapshot
        : [];

      if (examData) {
        // Keep the live exam's metadata, but review against the snapshot.
        // Submissions from before the snapshot existed fall back to whatever
        // the exam document still has.
        if (snapshot.length > 0) {
          setExam({ ...examData, questions: snapshot } as unknown as Exam);
        }
      } else {
        // The live exam was unreadable (closed or retargeted) — rebuild just
        // enough of it from the submission so the review still renders.
        setExam({
          id: examId,
          title: answerDocData.examTitle || "Exam Review",
          courseName: answerDocData.courseName || "",
          totalMarks: answerDocData.totalMarks ?? answerDocData.grading?.totalMarks ?? 0,
          questions: snapshot,
          settings: { allowReview: true },
        } as unknown as Exam);
      }
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

  if (loading || !initialized || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!exam || !answerData) {
    return null;
  }

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

        <ExamAnswerReview exam={exam} session={session} answerData={answerData} />

      </div>
    </div>
  );
}
