"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Shield, User, Mail, Calendar, ArrowLeft, Save, Loader2, Camera, Lock, Eye, EyeOff, KeyRound, Phone, GraduationCap, School, BookOpen, Layers, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserProfile, changePassword } from "@/lib/firebase/auth";
import { uploadFile } from "@/lib/firebase/storage";
import { validateStrongPassword } from "@/lib/utils/validation";
import { formatDate } from "@/lib/utils/helpers";
import Navbar from "@/components/Navbar";

/**
 * A profile value the user can see but not change. Rendered as text rather
 * than a disabled input so it never looks like a field that has gone
 * temporarily unavailable.
 */
function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-gray-500">{label}</Label>
      <p className="text-sm font-medium text-gray-900 h-10 flex items-center px-3 rounded-md bg-gray-50 border border-gray-200">
        {value?.trim() || <span className="text-gray-400 font-normal">Not set</span>}
      </p>
    </div>
  );
}

export default function ProfilePage() {
  const { user, loading: authLoading, initialized } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Student Academic State

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setPhone(user.phone || "");
      setAvatarUrl(user.avatarUrl || "");
    }
  }, [user]);

  useEffect(() => {
    if (initialized && !authLoading && !user) {
      router.replace("/login");
    }
  }, [initialized, authLoading, user, router]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid File", description: "Please select an image file (PNG, JPG, WebP)", variant: "destructive" });
      return;
    }

    setUploadingAvatar(true);
    try {
      const timestamp = Date.now();
      const path = `avatars/${user.id}/${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const res = await uploadFile(file, path);
      
      await updateUserProfile(user.id, { avatarUrl: res.url });
      setAvatarUrl(res.url);
      
      toast({
        title: "Profile Picture Updated",
        description: "Your avatar has been saved successfully.",
      });
    } catch (error: any) {
      console.error("Avatar upload failed:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload avatar",
        variant: "destructive",
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      await updateUserProfile(user.id, { name, phone, avatarUrl });
      toast({
        title: "Profile Updated",
        description: "Your profile has been updated successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!currentPassword) {
      toast({ title: "Error", description: "Please enter your current password.", variant: "destructive" });
      return;
    }

    const strength = validateStrongPassword(newPassword);
    if (!strength.isValid) {
      toast({ title: "Weak Password", description: strength.error, variant: "destructive" });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast({ title: "Error", description: "New password and confirmation do not match.", variant: "destructive" });
      return;
    }

    if (newPassword === currentPassword) {
      toast({ title: "Error", description: "New password must be different from your current password.", variant: "destructive" });
      return;
    }

    setChangingPassword(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.success) {
        toast({ title: "Password Changed", description: "Your password has been updated successfully." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      } else {
        toast({ title: "Error", description: result.error || "Failed to change password.", variant: "destructive" });
      }
    } finally {
      setChangingPassword(false);
    }
  };

  if (!initialized || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-green-200 border-t-green-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const getDashboardLink = () => {
    switch (user.role) {
      case "admin":
        return "/dashboard/admin";
      case "teacher":
        return user.approved ? "/dashboard/teacher" : "/pending-approval";
      case "student":
        return "/dashboard/student";
      default:
        return "/";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-emerald-50">
      <Navbar />
      
      <main className="pt-24 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => router.push(getDashboardLink())}
            className="mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center space-x-4">
                  <div className="relative group">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleAvatarChange} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    {avatarUrl ? (
                      <img 
                        src={avatarUrl} 
                        alt={user.name} 
                        className="w-16 h-16 rounded-full object-cover border-2 border-emerald-500 shadow-sm" 
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-2xl font-bold shadow-sm">
                        {user.name?.charAt(0).toUpperCase() || "U"}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingAvatar}
                      className="absolute bottom-0 right-0 p-1.5 bg-emerald-600 text-white rounded-full shadow-md hover:bg-emerald-700 transition-colors flex items-center justify-center"
                      title="Change Profile Picture"
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Camera className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{user.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <span className="inline-block px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full capitalize">
                        {user.role}
                      </span>
                      {user.role === "teacher" && (
                        <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                          user.approved 
                            ? "bg-green-100 text-green-700" 
                            : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {user.approved ? "Approved" : "Pending Approval"}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-10"
                        placeholder="Your name"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="pl-10"
                        placeholder="+880 1XXX-XXXXXX"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="email"
                        type="email"
                        value={user.email}
                        className="pl-10 bg-gray-50"
                        disabled
                      />
                    </div>
                    <p className="text-xs text-gray-500">Email cannot be changed</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Account Created</Label>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Calendar className="h-4 w-4" />
                      <span>{user.createdAt ? formatDate(user.createdAt) : "Unknown"}</span>
                    </div>
                  </div>

                  <Button type="submit" disabled={saving} className="w-full">
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Academic Enrollment (Students) — READ ONLY.
                This used to be an editable form that saved batch/section and
                toasted "Teacher assignments updated." It did neither reliably:
                refreshing the roster means writing `teacher_student_mapping`
                and the student's own `assignedTeacherIds`, both admin-only by
                rule, so the write was denied and swallowed. The student was
                left with a profile claiming one section and access to none.

                It is also the placement that decides whose exams and notices
                the account receives, so it is not the student's to change. */}
            {user.role === "student" && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-emerald-600" /> Academic Enrollment
                  </CardTitle>
                  <CardDescription>
                    Your class placement. It determines which teachers, exams and notices
                    reach you.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ReadOnlyField label="Department" value={user.department} />
                    <ReadOnlyField label="Student ID" value={user.studentCode} />
                    <ReadOnlyField label="Batch" value={user.batch} />
                    <ReadOnlyField
                      label="Section"
                      value={user.section || user.sections?.[0]}
                    />
                  </div>

                  <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-900 leading-relaxed">
                      Need a correction? Contact your administrator — moving between
                      sections changes which classes you belong to, so only they can do it.
                    </p>
                  </div>

                  {(user.assignedTeacherIds?.length ?? 0) === 0 && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-900 leading-relaxed">
                        No teacher has been assigned to your section yet, so you won&apos;t
                        see notices or exams. Your administrator needs to assign one.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Change Password */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-emerald-600" /> Change Password
                </CardTitle>
                <CardDescription>
                  Use a strong password: at least 8 characters, with uppercase, lowercase, a number, and a special character.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="currentPassword"
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="pl-10 pr-10"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                        aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                      >
                        {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="newPassword"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="pl-10 pr-10"
                        placeholder="••••••••"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                        aria-label={showNewPassword ? "Hide password" : "Show password"}
                      >
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        id="confirmNewPassword"
                        type={showConfirmNewPassword ? "text" : "password"}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        className="pl-10 pr-10"
                        placeholder="••••••••"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                        aria-label={showConfirmNewPassword ? "Hide password" : "Show password"}
                      >
                        {showConfirmNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" disabled={changingPassword} className="w-full">
                    {changingPassword ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating Password...
                      </>
                    ) : (
                      <>
                        <KeyRound className="mr-2 h-4 w-4" />
                        Update Password
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Profile Overview Stats */}
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5 text-emerald-600" /> Account Security & Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <div className="flex justify-between items-center py-2 border-b">
                  <span>Role Classification</span>
                  <span className="font-semibold text-slate-900 capitalize">{user.role}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span>Proctoring Integrity Record</span>
                  <span className="font-semibold text-emerald-600">Good Standing</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span>Platform Verification</span>
                  <span className="font-semibold text-blue-600">Verified User</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
