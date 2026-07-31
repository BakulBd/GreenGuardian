import {
  collection,
  doc,
  getDoc,
  getDocs,
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
  writeBatch,
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
 * Validate notice data before saving.
 * Throws an error with a specific message if validation fails.
 */
function validateNoticeData(
  data: Partial<Notice>,
  isUpdate = false
): void {
  if (!isUpdate) {
    if (!data.title || !data.title.trim()) {
      throw new Error("Title is required.");
    }
    if (!data.description || !data.description.trim()) {
      throw new Error("Description is required.");
    }
    if (!data.teacherId) {
      throw new Error("Teacher ID is required.");
    }
    if (!data.teacherName) {
      throw new Error("Teacher name is required.");
    }
    if (!data.targetType) {
      throw new Error("Target audience is required.");
    }
  }

  // Validate target type specific fields
  if (data.targetType === "course" && !data.targetCourseId) {
    throw new Error("Course is required when targeting a specific course.");
  }
  if (data.targetType === "batch" && !data.targetBatch) {
    throw new Error("Batch is required when targeting a specific batch.");
  }
  if (data.targetType === "section" && !data.targetSection) {
    throw new Error("Section is required when targeting a specific section.");
  }
  if (data.targetType === "semester" && !data.targetBatch) {
    throw new Error("Semester/Batch is required when targeting a specific semester.");
  }

  // Validate title length
  if (data.title && data.title.trim().length > 500) {
    throw new Error("Title is too long (max 500 characters).");
  }

  // Validate external link format
  if (data.externalLink && data.externalLink.trim()) {
    try {
      new URL(data.externalLink);
    } catch {
      throw new Error("External link is not a valid URL.");
    }
  }
}

/**
 * Create a new notice. For published notices, this only creates the document.
 * Notifications are sent separately via publishNoticeWithNotifications().
 */
export async function createNotice(
  data: Omit<Notice, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  // Validate required fields
  validateNoticeData(data as Partial<Notice>);

  try {
    console.log("[Notices] Creating notice:", {
      title: data.title,
      status: data.status,
      targetType: data.targetType,
      teacherId: data.teacherId,
    });

    // Strip undefined values - Firestore doesn't accept undefined field values
    const cleanData: Record<string, any> = {};
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        cleanData[key] = value;
      }
    });

    const docData: Record<string, any> = {
      ...cleanData,
      title: data.title.trim(),
      description: data.description.trim(),
      status: data.status || "draft",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Only set publishedAt if publishing immediately
    if (data.status === "published") {
      docData.publishedAt = serverTimestamp();
    }

    console.log("[Notices] Saving notice data:", JSON.stringify({
      title: docData.title,
      status: docData.status,
      targetType: docData.targetType,
      fields: Object.keys(docData),
    }));

    const docRef = await addDoc(collection(db, "notices"), docData);
    console.log("[Notices] Notice created successfully:", docRef.id);
    return docRef.id;
  } catch (error: any) {
    console.error("[Notices] Error creating notice:", {
      code: error.code,
      message: error.message,
      details: error.details,
    });
    throw new Error(
      error.code === "permission-denied"
        ? "Permission denied. You may not have access to create notices."
        : error.message || "Failed to create notice. Please try again."
    );
  }
}

/**
 * Get a single notice by ID.
 */
export async function getNotice(noticeId: string): Promise<Notice | null> {
  try {
    const noticeDoc = await getDoc(doc(db, "notices", noticeId));
    if (!noticeDoc.exists()) return null;
    return { ...noticeDoc.data(), id: noticeDoc.id } as Notice;
  } catch (error: any) {
    console.error("[Notices] Error getting notice:", error);
    throw new Error("Failed to fetch notice.");
  }
}

/**
 * Get all notices created by a specific teacher.
 */
export async function getTeacherNotices(teacherId: string): Promise<Notice[]> {
  try {
    const q = query(
      collection(db, "notices"),
      where("teacherId", "==", teacherId),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Notice));
  } catch (error: any) {
    console.error("[Notices] Error getting teacher notices:", error);
    throw new Error("Failed to load notices.");
  }
}

/**
 * Get all published notices targeted to a specific student based on their profile.
 */
export async function getStudentNotices(student: User): Promise<Notice[]> {
  try {
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
  } catch (error: any) {
    console.error("[Notices] Error getting student notices:", error);
    throw new Error("Failed to load notices.");
  }
}

/**
 * Update an existing notice.
 */
export async function updateNotice(
  noticeId: string,
  data: Partial<Notice>
): Promise<void> {
  // Validate update data
  validateNoticeData(data, true);

try {
    // Strip undefined values - Firestore doesn't accept undefined field values
    const cleanData: Record<string, any> = { updatedAt: serverTimestamp() };
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        cleanData[key] = value;
      }
    });
    if (data.title) cleanData.title = data.title.trim();
    if (data.description) cleanData.description = data.description.trim();

    // If publishing, set publishedAt
    if (data.status === "published") {
      cleanData.publishedAt = serverTimestamp();
    }

    await updateDoc(doc(db, "notices", noticeId), cleanData);
    console.log("[Notices] Notice updated:", noticeId);
  } catch (error: any) {
    console.error("[Notices] Error updating notice:", error);
    throw new Error(
      error.code === "permission-denied"
        ? "Permission denied. You may not have access to update this notice."
        : error.message || "Failed to update notice."
    );
  }
}

/**
 * Delete a notice and its associated read records.
 */
export async function deleteNotice(noticeId: string): Promise<void> {
  try {
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

    // Delete associated notifications for this notice
    const notifQuery = query(
      collection(db, "notifications"),
      where("noticeId", "==", noticeId)
    );
    const notifSnapshot = await getDocs(notifQuery);
    const notifDeletePromises = notifSnapshot.docs.map((d) =>
      deleteDoc(doc(db, "notifications", d.id))
    );
    await Promise.all(notifDeletePromises);

    // Delete the notice
    await deleteDoc(doc(db, "notices", noticeId));
    console.log("[Notices] Notice deleted:", noticeId);
  } catch (error: any) {
    console.error("[Notices] Error deleting notice:", error);
    throw new Error(
      error.code === "permission-denied"
        ? "Permission denied. You may not have access to delete this notice."
        : "Failed to delete notice."
    );
  }
}

/**
 * Publish a notice and create notifications for all targeted students.
 * Uses batched writes for atomicity.
 */
export async function publishNoticeWithNotifications(
  noticeId: string,
  targetedStudentIds: string[]
): Promise<{ noticeId: string; notificationCount: number }> {
  try {
    console.log("[Notices] Publishing notice:", noticeId, "to", targetedStudentIds.length, "students");

    // Get the notice data for notification content
    const notice = await getNotice(noticeId);
    if (!notice) {
      throw new Error("Notice not found.");
    }

    // Use batched writes for atomicity
    // We batch in groups of 500 (Firestore batch limit)
    const batchSize = 499; // Leave room for the notice update
    let totalNotifications = 0;

    for (let i = 0; i < targetedStudentIds.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = targetedStudentIds.slice(i, i + batchSize);

      // Update notice status to published (only if not already published)
      if (i === 0) {
        batch.update(doc(db, "notices", noticeId), {
          status: "published",
          publishedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // Create notification for each student
      for (const studentId of chunk) {
        const notifRef = doc(collection(db, "notifications"));
        batch.set(notifRef, {
          userId: studentId,
          type: "notice",
          title: "New Notice",
          message: `${notice.title}`,
          noticeId: notice.id,
          read: false,
          createdAt: serverTimestamp(),
        });
        totalNotifications++;
      }

      await batch.commit();
      console.log(`[Notices] Batch committed: ${chunk.length} notifications`);
    }

    console.log(`[Notices] Notice published successfully: ${noticeId}, ${totalNotifications} notifications created`);
    return { noticeId, notificationCount: totalNotifications };
  } catch (error: any) {
    console.error("[Notices] Error publishing notice:", {
      code: error.code,
      message: error.message,
      details: error.details,
    });
    throw new Error(
      error.code === "permission-denied"
        ? "Permission denied. Cannot publish notice or send notifications."
        : error.message || "Failed to publish notice."
    );
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
  try {
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
  } catch (error: any) {
    console.error("[Notices] Error marking notice as read:", error);
    throw new Error("Failed to mark notice as read.");
  }
}

/**
 * Check if a student has read a notice.
 */
export async function isNoticeRead(
  noticeId: string,
  studentId: string
): Promise<boolean> {
  try {
    const q = query(
      collection(db, "noticeReads"),
      where("noticeId", "==", noticeId),
      where("studentId", "==", studentId),
      limit(1)
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error: any) {
    console.error("[Notices] Error checking notice read status:", error);
    return false;
  }
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

  try {
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
  } catch (error: any) {
    console.error("[Notices] Error getting notices read status:", error);
    return noticeIds.reduce((acc, id) => ({ ...acc, [id]: false }), {});
  }
}

// ===================== Notifications =====================

/**
 * Get all notifications for a user, sorted by newest first.
 */
export async function getNotifications(
  userId: string,
  limitCount: number = 50
): Promise<Notification[]> {
  try {
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Notification));
  } catch (error: any) {
    console.error("[Notices] Error getting notifications:", error);
    throw new Error("Failed to load notifications.");
  }
}

/**
 * Get unread notification count for a user.
 */
export async function getUnreadNotificationCount(
  userId: string
): Promise<number> {
  try {
    const q = query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      where("read", "==", false)
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error: any) {
    console.error("[Notices] Error getting unread count:", error);
    return 0;
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(
  notificationId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, "notifications", notificationId), {
      read: true,
    });
  } catch (error: any) {
    console.error("[Notices] Error marking notification as read:", error);
    throw new Error("Failed to mark notification as read.");
  }
}

/**
 * Mark all notifications for a user as read.
 */
export async function markAllNotificationsRead(
  userId: string
): Promise<void> {
  try {
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
  } catch (error: any) {
    console.error("[Notices] Error marking all notifications as read:", error);
    throw new Error("Failed to mark notifications as read.");
  }
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
  }, (error) => {
    console.error("[Notices] Real-time subscription error:", error);
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
  }, (error) => {
    console.error("[Notices] Unread count subscription error:", error);
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
  try {
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
          return notice.targetStudentIds;
        }
        return [];
      default:
        return [];
    }

    const q = query(studentsRef, ...constraints);
    const snapshot = await getDocs(q);
    const studentIds = snapshot.docs.map((doc) => doc.id);
    console.log(`[Notices] Found ${studentIds.length} targeted students for notice ${notice.id}`);
    return studentIds;
  } catch (error: any) {
    console.error("[Notices] Error getting targeted student IDs:", error);
    throw new Error("Failed to determine targeted students.");
  }
}

/**
 * Format a firestore date for display.
 */
export function formatNoticeDate(date: any): string {
  if (!date) return "N/A";
  try {
    const d = date?.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "N/A";
  }
}

/**
 * Get a human-readable label for the target type.
 */
export function getTargetLabel(notice: Notice): string {
  switch (notice.targetType) {
    case "all":
      return "All Students";
    case "course":
      return `Course: ${notice.targetCourseName || notice.targetCourseId || "N/A"}`;
    case "batch":
      return `Batch: ${notice.targetBatch || "N/A"}`;
    case "section":
      return `Section: ${notice.targetSection || "N/A"}`;
    case "semester":
      return `Semester/Batch: ${notice.targetBatch || "N/A"}`;
    case "individual":
      return `Individual Students (${notice.targetStudentIds?.length || 0})`;
    default:
      return "Unknown";
  }
}

/**
 * Get a human-readable status label.
 */
export function getStatusLabel(status: NoticeStatus): string {
  return status === "published" ? "Published" : "Draft";
}
