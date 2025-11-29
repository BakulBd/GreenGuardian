import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./config";
import { AppSettings } from "@/lib/types";

export async function ensureDefaultSettings(): Promise<{ created: boolean; settings: AppSettings }> {
  const ref = doc(db, "settings", "app");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { created: false, settings: snap.data() as AppSettings };
  }

  const defaults: AppSettings = {
    id: "app",
    riskThresholds: { low: 20, medium: 50, high: 80 },
    defaultExamSettings: {
      requireWebcam: true,
      allowedTabSwitches: 2,
      faceMissingTolerance: 10,
      attentionTimeout: 20,
      fileUploadsAllowed: true,
      shuffleQuestions: true,
      autoSubmitOnTimeout: true,
      allowedLateSubmission: false,
      lateSubmissionMinutes: 0,
    },
    plagiarismThreshold: 0.8,
    allowTeacherRegistration: true,
    updatedAt: serverTimestamp() as any,
    updatedBy: "bootstrap",
  };

  await setDoc(ref, defaults, { merge: true });
  const saved = await getDoc(ref);
  return { created: true, settings: saved.data() as AppSettings };
}
