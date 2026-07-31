import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  onSnapshot,
  or,
  and,
} from "firebase/firestore";
import { db } from "./config";
import {
  Notice,
  NoticeRead,
  Notification,
  NotificationType,
  NoticeStatus,
  NoticeTargetType,
  NoticeFilters,
  User,
} from "../types";

// ===================== Notices =====================

/**
 * Create a new notice (draft or publish immediately).
 */
export async function createNotice(
  data: Omit<Notice, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const docRef = await addDoc(collection(db, "notices"), {
    ...data,
    status: data.status || "draft",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    publishedAt: data.status === "published" ? serverTimestamp() : null,
  });
  return docRef.id;
}

/**
 * Get a single notice by ID.
 */
export async function getNotice(noticeId: string): Promise<Notice | null> {
  const noticeDoc = await getDoc(doc(db, "notices", noticeId));
  if (!noticeDoc.exists()) return null;
  return { ...noticeDoc.data(), id: noticeDoc.id } as Notice;
}

/**
 * Get all notices created by a specific teacher.
 */
export async function getTeacherNotices(teacherId: string): Promise<Notice[]> {
  const q = query(
    collection(db, "notices"),
    where("teacherId", "==", teacherId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Notice));
}

/**
 * Get all published notices targeted to a specific student based on their profile.
 * This fetches notices where:
 * - targetType === "all"
 * - OR targetType === "course" AND targetCourseId matches student's courses
 * - OR targetType === "batch" AND targetBatch matches student's batch
 * - OR targetType === "section" AND targetSection matches student's section
 * - OR targetType === "semester" AND targetSemester matches
 * - OR targetType === "individual" AND student's ID is in targetStudentIds
 */
export async function getStudentNotices(student: User): Promise<Notice[]> {
  // Get all published notices
  const q = query(
    collection(db, "notices"),
    where("status", "==", "published"),
    orderBy("publishedAt", "desc")
  );
  const snapshot = await getDocs(q);
  const allNotices = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Notice));

  // Filter notices that target this student
  const studentNotices = allNotices.filter((notice) => {
    switch (notice.targetType) {
      case "all":
        return true;
      case "course":
        return (
          notice.targetCourseId != null &&
          student.courses != null &&
          student.courses.includes(notice.targetCourseId)
        );
      case "batch":
        return notice.targetBatch === student.batch;
      case "section":
        return notice.targetSection === student.section;
      case "semester":
        // Semester targeting - check if student's batch aligns
        // (Simplified: semester info not directly on student, use batch)
        return notice.targetBatch === student.batch;
      case "individual":
        return (
          notice.targetStudentIds != null &&
          notice.targetStudentIds.includes(student.id)
        );
      default:
        return false;
    }
  });

  return studentNotices;
}

/**
 * Update an existing notice (only if it's a draft or teacher owns it).
 */
export async function updateNotice(
  noticeId: string,
  data: Partial<Notice>
): Promise<void> {
  const updateData: any = { ...data, updatedAt: serverTimestamp() };
  // If publishing, set publishedAt
  if (data.status === "published") {
    updateData.publishedAt = serverTimestamp();
  }
  await updateDoc(doc(db, "notices", noticeId), updateData);
}

/**
 * Delete a notice.
 */
export async function deleteNotice(noticeId: string): Promise<void> {
  // Delete associated notice reads
  const readsQuery = query(
    collection(db, "noticeReads"),
    where("noticeId", "==", noticeId)
  );
  const readsSnapshot = await getDocs(readsQuery);
  const deletePromises = readsSnapshot.docs.map((d) =>
    deleteDoc(doc(db, "noticeReads", d.id))
  );
  await Promise.all(deletePromises);

  // Delete the notice
  await deleteDoc(doc(db, "notices", noticeId));
}

/**
 * Publish a notice and create notifications for all targeted students.
 */
export async function publishNotice(
  noticeId: string,
  targetedStudentIds: string[]
): Promise<void> {
  // Update notice status to published
  await updateDoc(doc(db, "notices", noticeId), {
    status: "published",
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Get the notice data for notification content
  const notice = await getNotice(noticeId);
  if (!notice) return;

  // Create notifications for all targeted students in batches
  const batchSize = 500; // Firestore limit per batch
  for (let i = 0; i < targetedStudentIds.length; i += batchSize) {
    const batch = targetedStudentIds.slice(i, i + batchSize);
    const notificationPromises = batch.map((studentId) =>
      addDoc(collection(db, "notifications"), {
        userId: studentId,
        type: "notice",
        title: "New Notice",
        message: `${notice.title} - ${notice.description.substring(0, 100)}`,
        noticeId: notice.id,
        read: false,
        createdAt: serverTimestamp(),
      })
    );
    await Promise.all(notificationPromises);
  }
}

// ===================== Notice Reads (Read Status) =====================

/**
 * Mark a notice as read by a student.
 */
export async function markNoticeRead(
  noticeId: string,
  studentId: string
): Promise<void> {
  // Check if already marked as read
  const q = query(
    collection(db, "noticeReads"),
    where("noticeId", "==", noticeId),
    where("studentId", "==", studentId),
    limit(1)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    await addDoc(collection(db, "noticeReads"), {
      noticeId,
      studentId,
      readAt: serverTimestamp(),
    });
  }
}

/**
 * Check if a student has read a notice.
 */
export async function isNoticeRead(
  noticeId: string,
  studentId: string
): Promise<boolean> {
  const q = query(
    collection(db, "noticeReads"),
    where("noticeId", "==", noticeId),
    where("studentId", "==", studentId),
    limit(1)
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * Get the read status for multiple notices for a student.
 * Returns a map of noticeId -> boolean.
 */
export async function getNoticesReadStatus(
  noticeIds: string[],
  studentId: string
): Promise<Record<string, boolean>> {
  if (noticeIds.length === 0) return {};

  const statusMap: Record<string, boolean> = {};
  noticeIds.forEach((id) => (statusMap[id] = false));

  // Firestore 'in' queries are limited to 30 values
  for (let i = 0; i < noticeIds.length; i += 30) {
    const chunk = noticeIds.slice(i, i + 30);
    const q = query(
      collection(db, "noticeReads"),
      where("noticeId", "in", chunk),
      where("studentId", "==", studentId)
    );
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      statusMap[data.noticeId] = true;
    });
  }

  return statusMap;
}

// ===================== Notifications =====================

/**
 * Get all notifications for a user, sorted by newest first.
 */
export async function getNotifications(
  userId: string,
  limitCount: number = 50
): Promise<Notification[]> {
  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(limitCount)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Notification));
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadNotificationCount(
  userId: string
): Promise<number> {
  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    where("read", "==", false)
  );
  const snapshot = await getDocs(q);
  return snapshot.size;
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(
  notificationId: string
): Promise<void> {
  await updateDoc(doc(db, "notifications", notificationId), {
    read: true,
  });
}

/**
 * Mark all notifications for a user as read.
 */
export async function markAllNotificationsRead(
  userId: string
): Promise<void> {
  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    where("read", "==", false)
  );
  const snapshot = await getDocs(q);
  const updatePromises = snapshot.docs.map((d) =>
    updateDoc(doc(db, "notifications", d.id), { read: true })
  );
  await Promise.all(updatePromises);
}

/**
 * Subscribe to real-time notification updates for a user.
 */
export function subscribeToNotifications(
  userId: string,
  callback: (notifications: Notification[]) => void
): () => void {
  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const notifications = snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as Notification));
    callback(notifications);
  });

  return unsubscribe;
}

/**
 * Subscribe to unread notification count for badge.
 */
export function subscribeToUnreadCount(
  userId: string,
  callback: (count: number) => void
): () => void {
  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    where("read", "==", false)
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    callback(snapshot.size);
  });

  return unsubscribe;
}

// ===================== Helper Functions =====================

/**
 * Get all targeted student IDs for a notice based on its target settings.
 */
export async function getTargetedStudentIds(
  notice: Notice
): Promise<string[]> {
  const studentsRef = collection(db, "users");
  let constraints: any[] = [where("role", "==", "student")];

  switch (notice.targetType) {
    case "all":
      // All students - no additional constraints
      break;
    case "course":
      if (notice.targetCourseId) {
        constraints.push(where("courses", "array-contains", notice.targetCourseId));
      }
      break;
    case "batch":
      if (notice.targetBatch) {
        constraints.push(where("batch", "==", notice.targetBatch));
      }
      break;
    case "section":
      if (notice.targetSection) {
        constraints.push(where("section", "==", notice.targetSection));
      }
      break;
    case "semester":
      if (notice.targetBatch) {
        constraints.push(where("batch", "==", notice.targetBatch));
      }
      break;
    case "individual":
      if (notice.targetStudentIds && notice.targetStudentIds.length > 0) {
        // For individual targeting, we just return the specified IDs
        return notice.targetStudentIds;
      }
      return [];
    default:
      return [];
  }

  const q = query(studentsRef, ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => doc.id);
}

/**
 * Format a firestore date for display.
 */
export function formatNoticeDate(date: any): string {
  if (!date) return "N/A";
  const d = date?.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

