"use client";

import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2, Shield, Eye, AlertCircle, Activity, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase/config";

interface HealthState {
  adminSdk: boolean;
  email: boolean;
  encryption: boolean;
}

function HealthRow({
  ok,
  label,
  okText,
  failText,
}: {
  ok: boolean;
  label: string;
  okText: string;
  failText: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 ${
        ok ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className={`text-xs mt-0.5 leading-relaxed ${ok ? "text-green-800" : "text-red-800"}`}>
          {ok ? okText : failText}
        </p>
      </div>
    </div>
  );
}

/**
 * Only settings that something actually reads live here.
 *
 * The page previously also offered Site Name, Require Teacher Approval,
 * Email on New Teacher and Email on Exam Completion. Nothing in the codebase
 * ever read any of them, so toggling them changed nothing while looking like
 * it did. They are gone rather than left as decoration:
 *   - Teacher approval is a security gate enforced unconditionally in
 *     DashboardLayout and the login flow; making it switchable would only
 *     weaken it.
 *   - The notification switches described emails that are not sent from those
 *     events at all.
 */
interface Settings {
  /** Enforced server-side in /api/auth/register. */
  allowRegistration: boolean;
  proctoring: {
    /** Seeded into each new exam's proctoringSettings. */
    faceDetection: boolean;
    tabSwitchDetection: boolean;
    fullscreenRequired: boolean;
    /** Read live by the exam client to cap warnings before auto-submit. */
    maxWarnings: number;
  };
}

const defaultSettings: Settings = {
  allowRegistration: true,
  proctoring: {
    faceDetection: true,
    tabSwitchDetection: true,
    fullscreenRequired: true,
    maxWarnings: 5,
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [health, setHealth] = useState<HealthState | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = auth.currentUser;
        if (!current) return;
        const res = await fetch("/api/admin/health", {
          headers: { Authorization: `Bearer ${await current.getIdToken()}` },
        });
        if (!active) return;
        if (res.status === 503) {
          // requireAdmin returns 503 precisely when the Admin SDK is absent —
          // which is itself the answer to the first health question.
          setHealth({ adminSdk: false, email: false, encryption: false });
          return;
        }
        const data = await res.json().catch(() => null);
        if (!data?.success) {
          setHealth({ adminSdk: false, email: false, encryption: false });
          return;
        }
        setHealth({
          adminSdk: !!data.adminSdk?.firestoreOk && !!data.adminSdk?.authOk,
          email: !!data.email?.configured,
          encryption: !!data.encryption?.configured,
        });
      } catch {
        if (active) setHealth({ adminSdk: false, email: false, encryption: false });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const update = (next: Settings) => {
    setSettings(next);
    setDirty(true);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setError(null);
    try {
      const settingsDoc = await getDoc(doc(db, "settings", "global"));
      if (settingsDoc.exists()) {
        const data = settingsDoc.data() as Partial<Settings>;
        setSettings({
          ...defaultSettings,
          ...data,
          proctoring: { ...defaultSettings.proctoring, ...(data.proctoring || {}) },
        });
      }
      setDirty(false);
    } catch (err) {
      console.error("Error loading settings:", err);
      setError("Could not load settings. Showing defaults — saving will overwrite the stored values.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (settings.proctoring.maxWarnings < 1 || settings.proctoring.maxWarnings > 20) {
      toast({
        title: "Invalid value",
        description: "Maximum warnings must be between 1 and 20.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "global"), settings, { merge: true });
      setDirty(false);
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

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={loadSettings}>
              Retry
            </Button>
          </div>
        )}

        {/* Access */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-green-600" />
              <div>
                <CardTitle>Access</CardTitle>
                <CardDescription>Who may create an account</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <Label htmlFor="allowRegistration">Allow Self-Registration</Label>
                <p className="text-sm text-gray-500">
                  When off, the public sign-up form is refused server-side. Administrators can
                  still add students from the Students page.
                </p>
              </div>
              <Switch
                id="allowRegistration"
                checked={settings.allowRegistration}
                onCheckedChange={(checked) => update({ ...settings, allowRegistration: checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Deployment health.
            The two failure modes below are otherwise completely silent: with no
            Admin credentials every admin-only server action 503s, and with no
            SMTP the OTP and reset emails are written to the server log instead
            of being delivered. Both look like "the feature is broken". */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-indigo-600" />
              <div>
                <CardTitle>System Health</CardTitle>
                <CardDescription>
                  Server-side capabilities available in this deployment
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {health === null ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking...
              </div>
            ) : (
              <div className="space-y-2.5">
                <HealthRow
                  ok={health.adminSdk}
                  label="Firebase Admin credentials"
                  okText="Configured and working"
                  failText="Missing — admin account creation and password resets are unavailable. Set FIREBASE_SERVICE_ACCOUNT in your hosting environment."
                />
                <HealthRow
                  ok={health.email}
                  label="Email delivery (SMTP)"
                  okText="Configured — verification and reset emails are sent"
                  failText="Not configured — emails are only written to the server log, so users never receive their code. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM."
                />
                <HealthRow
                  ok={health.encryption}
                  label="Registration encryption key"
                  okText="Configured"
                  failText="REGISTRATION_ENC_KEY is unset — a fallback key is derived, which will invalidate in-flight registrations if the project id changes."
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Proctoring Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Eye className="h-5 w-5 text-blue-600" />
              <div>
                <CardTitle>Proctoring</CardTitle>
                <CardDescription>
                  Warning cap applies to every running exam. The detection switches are the
                  defaults applied to newly created exams; existing exams keep their own settings.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maxWarnings">Maximum Warnings</Label>
              <Input
                id="maxWarnings"
                type="number"
                min="1"
                max="20"
                value={settings.proctoring.maxWarnings}
                onChange={(e) =>
                  update({
                    ...settings,
                    proctoring: {
                      ...settings.proctoring,
                      maxWarnings: parseInt(e.target.value, 10) || 1,
                    },
                  })
                }
                className="w-32"
              />
              <p className="text-sm text-gray-500">
                A student&apos;s exam auto-submits once they exceed this many warnings.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 py-2 border-t pt-4">
              <div>
                <Label htmlFor="faceDetection">Face Detection (default)</Label>
                <p className="text-sm text-gray-500">Enable AI face detection on new exams</p>
              </div>
              <Switch
                id="faceDetection"
                checked={settings.proctoring.faceDetection}
                onCheckedChange={(checked) =>
                  update({
                    ...settings,
                    proctoring: { ...settings.proctoring, faceDetection: checked },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <Label htmlFor="tabSwitchDetection">Tab Switch Detection (default)</Label>
                <p className="text-sm text-gray-500">Flag students who leave the exam tab</p>
              </div>
              <Switch
                id="tabSwitchDetection"
                checked={settings.proctoring.tabSwitchDetection}
                onCheckedChange={(checked) =>
                  update({
                    ...settings,
                    proctoring: { ...settings.proctoring, tabSwitchDetection: checked },
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between gap-4 py-2">
              <div>
                <Label htmlFor="fullscreenRequired">Fullscreen Required (default)</Label>
                <p className="text-sm text-gray-500">Require fullscreen mode during new exams</p>
              </div>
              <Switch
                id="fullscreenRequired"
                checked={settings.proctoring.fullscreenRequired}
                onCheckedChange={(checked) =>
                  update({
                    ...settings,
                    proctoring: { ...settings.proctoring, fullscreenRequired: checked },
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-sm text-amber-700">Unsaved changes</span>}
          <Button onClick={handleSave} disabled={saving || !dirty}>
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
