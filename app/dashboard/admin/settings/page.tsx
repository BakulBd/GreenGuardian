"use client";

import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2, Shield, Bell, Eye, Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/config";

interface Settings {
  siteName: string;
  allowRegistration: boolean;
  requireTeacherApproval: boolean;
  proctoring: {
    faceDetection: boolean;
    tabSwitchDetection: boolean;
    fullscreenRequired: boolean;
    maxWarnings: number;
  };
  notifications: {
    emailOnNewTeacher: boolean;
    emailOnExamComplete: boolean;
  };
}

const defaultSettings: Settings = {
  siteName: "GreenGuardian",
  allowRegistration: true,
  requireTeacherApproval: true,
  proctoring: {
    faceDetection: true,
    tabSwitchDetection: true,
    fullscreenRequired: true,
    maxWarnings: 5,
  },
  notifications: {
    emailOnNewTeacher: true,
    emailOnExamComplete: true,
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settingsDoc = await getDoc(doc(db, "settings", "global"));
      if (settingsDoc.exists()) {
        setSettings({ ...defaultSettings, ...settingsDoc.data() as Settings });
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "global"), settings, { merge: true });
      toast({
        title: "Settings Saved",
        description: "Your settings have been updated successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout role="admin">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="admin">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-1">Configure your exam proctoring system</p>
        </div>

        {/* General Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-green-600" />
              <div>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>Basic configuration options</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="siteName">Site Name</Label>
              <Input
                id="siteName"
                value={settings.siteName}
                onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Allow Registration</Label>
                <p className="text-sm text-gray-500">Allow new users to register</p>
              </div>
              <Switch
                checked={settings.allowRegistration}
                onCheckedChange={(checked) => setSettings({ ...settings, allowRegistration: checked })}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Require Teacher Approval</Label>
                <p className="text-sm text-gray-500">Teachers must be approved before creating exams</p>
              </div>
              <Switch
                checked={settings.requireTeacherApproval}
                onCheckedChange={(checked) => setSettings({ ...settings, requireTeacherApproval: checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Proctoring Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Eye className="h-5 w-5 text-blue-600" />
              <div>
                <CardTitle>Proctoring Settings</CardTitle>
                <CardDescription>Default proctoring options for exams</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Face Detection</Label>
                <p className="text-sm text-gray-500">Enable AI-powered face detection</p>
              </div>
              <Switch
                checked={settings.proctoring.faceDetection}
                onCheckedChange={(checked) => setSettings({
                  ...settings,
                  proctoring: { ...settings.proctoring, faceDetection: checked }
                })}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Tab Switch Detection</Label>
                <p className="text-sm text-gray-500">Detect when students switch browser tabs</p>
              </div>
              <Switch
                checked={settings.proctoring.tabSwitchDetection}
                onCheckedChange={(checked) => setSettings({
                  ...settings,
                  proctoring: { ...settings.proctoring, tabSwitchDetection: checked }
                })}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Fullscreen Required</Label>
                <p className="text-sm text-gray-500">Require fullscreen mode during exams</p>
              </div>
              <Switch
                checked={settings.proctoring.fullscreenRequired}
                onCheckedChange={(checked) => setSettings({
                  ...settings,
                  proctoring: { ...settings.proctoring, fullscreenRequired: checked }
                })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxWarnings">Maximum Warnings</Label>
              <Input
                id="maxWarnings"
                type="number"
                min="1"
                max="20"
                value={settings.proctoring.maxWarnings}
                onChange={(e) => setSettings({
                  ...settings,
                  proctoring: { ...settings.proctoring, maxWarnings: parseInt(e.target.value) || 5 }
                })}
                className="w-32"
              />
              <p className="text-sm text-gray-500">Number of warnings before exam is flagged</p>
            </div>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-yellow-600" />
              <div>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>Email notification preferences</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <Label>New Teacher Registration</Label>
                <p className="text-sm text-gray-500">Receive email when a new teacher registers</p>
              </div>
              <Switch
                checked={settings.notifications.emailOnNewTeacher}
                onCheckedChange={(checked) => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, emailOnNewTeacher: checked }
                })}
              />
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Exam Completion</Label>
                <p className="text-sm text-gray-500">Receive email when exams are completed</p>
              </div>
              <Switch
                checked={settings.notifications.emailOnExamComplete}
                onCheckedChange={(checked) => setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, emailOnExamComplete: checked }
                })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
