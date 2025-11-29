"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { ensureDefaultSettings } from "@/lib/firebase/seeds";
import { getCurrentUser } from "@/lib/firebase/auth";
import { Settings } from "lucide-react";

export default function InitializeAdminPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        router.push("/login");
        return;
      }
      if (user.role !== "admin") {
        router.push("/dashboard/admin");
      }
    })();
  }, [router]);

  const handleInitialize = async () => {
    try {
      setBusy(true);
      const { created } = await ensureDefaultSettings();
      setResult(created ? "Default settings created." : "Settings already present.");
      toast({ title: "Initialization", description: created ? "Default settings created" : "Nothing to change" });
    } catch (e: any) {
      toast({ title: "Initialization failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5"/> Project Initialization</CardTitle>
            <CardDescription>One-time setup to seed default settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">This will create the default settings document at <code>settings/app</code> if it does not exist.</p>
            <Button onClick={handleInitialize} disabled={busy}>{busy ? "Initializing..." : "Create Default Settings"}</Button>
            {result && <p className="text-sm text-green-700">{result}</p>}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
