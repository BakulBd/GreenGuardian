"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Pin,
  PinOff,
  Trash2,
  Edit,
  MessageSquare,
  Send,
  Megaphone,
  Bell,
  FileText,
  Paperclip,
  Download,
  Link as LinkIcon,
  X,
  Loader2,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import FileUpload from "@/components/FileUpload";
import {
  createClassroomPost,
  updateClassroomPost,
  deleteClassroomPost,
  togglePinPost,
  subscribeToClassroomPosts,
  addClassroomComment,
  deleteClassroomComment,
  subscribeToPostComments,
  notifyClassroom,
} from "@/lib/firebase/classrooms";
import { CLASSROOM_MATERIAL_ALLOWED_TYPES, CLASSROOM_MAX_FILE_SIZE, UploadResult } from "@/lib/firebase/storage";
import { Classroom, ClassroomPost, ClassroomPostType, ClassroomComment, ClassroomAttachment, User } from "@/lib/types";

interface StreamTabProps {
  classroom: Classroom;
  isTeacher: boolean;
  currentUser: User;
}

const POST_TYPE_META: Record<ClassroomPostType, { label: string; icon: any; color: string }> = {
  announcement: { label: "Announcement", icon: Megaphone, color: "bg-blue-100 text-blue-700 border-blue-200" },
  notice: { label: "Notice", icon: Bell, color: "bg-amber-100 text-amber-700 border-amber-200" },
  material: { label: "Material", icon: FileText, color: "bg-purple-100 text-purple-700 border-purple-200" },
};

function formatTime(value: any): string {
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d?.getTime?.())) return "Just now";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function StreamTab({ classroom, isTeacher, currentUser }: StreamTabProps) {
  const { toast } = useToast();
  const [posts, setPosts] = useState<ClassroomPost[]>([]);
  const [loading, setLoading] = useState(true);

  // Composer state
  const [showComposer, setShowComposer] = useState(false);
  const [postType, setPostType] = useState<ClassroomPostType>("announcement");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<UploadResult[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToClassroomPosts(classroom.id, (data) => {
      setPosts(data);
      setLoading(false);
    });
    return () => unsub();
  }, [classroom.id]);

  const resetComposer = () => {
    setTitle("");
    setContent("");
    setAttachments([]);
    setLinkUrl("");
    setPostType("announcement");
    setEditingPostId(null);
    setShowComposer(false);
  };

  const handlePublish = async () => {
    if (!content.trim() && attachments.length === 0 && !linkUrl.trim()) {
      toast({ title: "Empty post", description: "Add some text or an attachment first.", variant: "destructive" });
      return;
    }
    setPosting(true);
    try {
      const finalAttachments: ClassroomAttachment[] = attachments.map((a) => ({ name: a.name, url: a.url, type: a.type, size: a.size }));
      if (linkUrl.trim()) {
        finalAttachments.push({ name: linkUrl.trim(), url: linkUrl.trim(), type: "link" });
      }

      if (editingPostId) {
        await updateClassroomPost(editingPostId, { title: title.trim() || undefined, content: content.trim(), attachments: finalAttachments });
        toast({ title: "Post Updated" });
      } else {
        const postId = await createClassroomPost({
          classroomId: classroom.id,
          teacherId: currentUser.id,
          teacherName: currentUser.name,
          type: postType,
          title: title.trim() || undefined,
          content: content.trim(),
          attachments: finalAttachments,
        });
        toast({ title: "Posted", description: `${POST_TYPE_META[postType].label} published to the class.` });
        // Fire-and-forget email/notification fan-out — doesn't block the UI.
        notifyClassroom({ classroomId: classroom.id, postId, kind: "post" });
      }
      resetComposer();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to publish post", variant: "destructive" });
    } finally {
      setPosting(false);
    }
  };

  const startEdit = (post: ClassroomPost) => {
    setEditingPostId(post.id);
    setPostType(post.type);
    setTitle(post.title || "");
    setContent(post.content);
    setAttachments([]);
    setShowComposer(true);
  };

  const handleDelete = async (post: ClassroomPost) => {
    if (!confirm("Delete this post and its comments? This cannot be undone.")) return;
    try {
      await deleteClassroomPost(post.id);
      toast({ title: "Post Deleted" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete post", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {isTeacher && (
        <Card>
          <CardContent className="pt-6">
            {!showComposer ? (
              <button
                onClick={() => setShowComposer(true)}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Share something with your class...
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {(Object.keys(POST_TYPE_META) as ClassroomPostType[]).map((t) => {
                    const meta = POST_TYPE_META[t];
                    const Icon = meta.icon;
                    return (
                      <Button
                        key={t}
                        type="button"
                        size="sm"
                        variant={postType === t ? "default" : "outline"}
                        onClick={() => setPostType(t)}
                        disabled={!!editingPostId}
                      >
                        <Icon className="h-3.5 w-3.5 mr-1" />
                        {meta.label}
                      </Button>
                    );
                  })}
                </div>
                <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
                <Textarea
                  placeholder="What do you want to share?"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                />
                <FileUpload
                  basePath={`classrooms/${classroom.id}/posts`}
                  onUploadComplete={setAttachments}
                  maxFiles={10}
                  allowedTypes={CLASSROOM_MATERIAL_ALLOWED_TYPES}
                  maxSize={CLASSROOM_MAX_FILE_SIZE}
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.zip,.jpg,.jpeg,.png,.gif,.webp,.mp4,.webm,.mov"
                />
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-gray-400" />
                  <Input placeholder="Attach a link (optional)" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={resetComposer} disabled={posting}>
                    Cancel
                  </Button>
                  <Button onClick={handlePublish} disabled={posting}>
                    {posting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                    {editingPostId ? "Save Changes" : "Post"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-green-600 mx-auto" />
        </div>
      ) : posts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            <Megaphone className="mx-auto h-12 w-12 text-gray-300 mb-3" />
            <p>Nothing posted yet.</p>
          </CardContent>
        </Card>
      ) : (
        posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            isTeacher={isTeacher}
            currentUser={currentUser}
            onEdit={() => startEdit(post)}
            onDelete={() => handleDelete(post)}
            onTogglePin={() => togglePinPost(post.id, !post.pinned)}
          />
        ))
      )}
    </div>
  );
}

function PostCard({
  post,
  isTeacher,
  currentUser,
  onEdit,
  onDelete,
  onTogglePin,
}: {
  post: ClassroomPost;
  isTeacher: boolean;
  currentUser: User;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  const { toast } = useToast();
  const meta = POST_TYPE_META[post.type] || POST_TYPE_META.announcement;
  const Icon = meta.icon;
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<ClassroomComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    if (!showComments) return;
    const unsub = subscribeToPostComments(post.id, setComments);
    return () => unsub();
  }, [showComments, post.id]);

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      await addClassroomComment({
        postId: post.id,
        classroomId: post.classroomId,
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorRole: currentUser.role,
        content: commentText,
      });
      setCommentText("");
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to add comment", variant: "destructive" });
    } finally {
      setSubmittingComment(false);
    }
  };

  return (
    <Card className={post.pinned ? "border-amber-300 bg-amber-50/40" : ""}>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={meta.color}>
              <Icon className="h-3 w-3 mr-1" />
              {meta.label}
            </Badge>
            {post.pinned && (
              <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
                <Pin className="h-3 w-3 mr-1" /> Pinned
              </Badge>
            )}
            <span className="text-xs text-gray-500">
              {post.teacherName} &middot; {formatTime(post.createdAt)}
            </span>
          </div>
          {isTeacher && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={onTogglePin} title={post.pinned ? "Unpin" : "Pin"}>
                {post.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={onEdit} title="Edit">
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onDelete} title="Delete" className="text-red-600 hover:text-red-700">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        {post.title && <h3 className="font-semibold text-gray-900">{post.title}</h3>}
        {post.content && <p className="text-sm text-gray-800 whitespace-pre-wrap">{post.content}</p>}

        {post.attachments && post.attachments.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {post.attachments.map((att, idx) => (
              <a
                key={idx}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2.5 rounded-lg border bg-gray-50 hover:bg-gray-100 transition-colors text-sm"
              >
                {att.type === "link" ? <LinkIcon className="h-4 w-4 text-blue-500 flex-shrink-0" /> : <Paperclip className="h-4 w-4 text-gray-500 flex-shrink-0" />}
                <span className="truncate flex-1 text-gray-800">{att.name}</span>
                {att.type !== "link" && <Download className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
              </a>
            ))}
          </div>
        )}

        <div className="pt-2 border-t">
          <button
            onClick={() => setShowComments((v) => !v)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {showComments ? "Hide comments" : "Comment"}
          </button>

          {showComments && (
            <div className="mt-3 space-y-2">
              {comments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2 p-2 rounded bg-gray-50 text-sm">
                  <div>
                    <span className="font-medium text-gray-800">{c.authorName}</span>{" "}
                    <span className="text-xs text-gray-400">{formatTime(c.createdAt)}</span>
                    <p className="text-gray-700">{c.content}</p>
                  </div>
                  {(c.authorId === currentUser.id || isTeacher) && (
                    <button onClick={() => deleteClassroomComment(c.id)} className="text-gray-400 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
                />
                <Button size="sm" onClick={handleAddComment} disabled={submittingComment}>
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
