"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GraduationCap, ShieldCheck, ArrowRight, Loader2, Sparkles, Building2, Layers, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAcademicCatalog } from "@/hooks/useAcademicCatalog";
import { DEFAULT_DEPARTMENT, DEFAULT_BATCHES, DEFAULT_SECTIONS } from "@/lib/academics/catalog";
import { updateUserProfile } from "@/lib/firebase/auth";
import { User } from "@/lib/types";

interface StudentOnboardingModalProps {
  isOpen: boolean;
  user: User;
  onSuccess: () => void;
}

export default function StudentOnboardingModal({
  isOpen,
  user,
  onSuccess,
}: StudentOnboardingModalProps) {
  const catalog = useAcademicCatalog();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const batchNames = useMemo(() => {
    const names = Array.from(new Set(catalog.batches.map((b) => b.name).filter(Boolean)));
    const list = names.length > 0 ? names : DEFAULT_BATCHES.map((b) => b.name);
    return list.sort();
  }, [catalog.batches]);

  const sectionNames = useMemo(() => {
    const names = Array.from(new Set(catalog.sections.map((s) => s.name).filter(Boolean)));
    const list = names.length > 0 ? names : DEFAULT_SECTIONS.map((s) => s.name);
    return list.sort();
  }, [catalog.sections]);

  const departmentNames = useMemo(() => {
    const names = Array.from(new Set(catalog.courses.map((c) => c.departmentName).filter(Boolean))) as string[];
    return names.length > 0 ? names : [DEFAULT_DEPARTMENT.name];
  }, [catalog.courses]);

  const [department, setDepartment] = useState(user.department || DEFAULT_DEPARTMENT.name);
  const [batch, setBatch] = useState(user.batch || "");
  const [section, setSection] = useState(user.section || "");
  const [studentCode, setStudentCode] = useState(user.studentCode || "");

  useEffect(() => {
    if (!batch && batchNames.length > 0) setBatch(batchNames[0]);
    if (!section && sectionNames.length > 0) setSection(sectionNames[0]);
  }, [batchNames, sectionNames, batch, section]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batch || !section) {
      toast({
        title: "Selection Required",
        description: "Please select both a Batch and a Section.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await updateUserProfile(user.id, {
        department: department || DEFAULT_DEPARTMENT.name,
        batch,
        section,
        sections: [section],
        studentCode: studentCode.trim(),
      });

      toast({
        title: "Academic Profile Setup Complete!",
        description: `Enrolled in Batch ${batch} / Section ${section}. Your exams and classrooms are now connected.`,
      });

      onSuccess();
    } catch (err: any) {
      console.error("Onboarding failed:", err);
      toast({
        title: "Setup Failed",
        description: err.message || "Could not save your academic profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden border border-emerald-100"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 p-6 text-white relative overflow-hidden">
            <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-white/10 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-white/20 backdrop-blur-md rounded-2xl">
                <GraduationCap className="h-6 w-6 text-white" />
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 backdrop-blur-md text-emerald-100 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Welcome to GreenGuardian
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold">Complete Your Student Profile</h2>
            <p className="text-emerald-100 text-xs sm:text-sm mt-1">
              Select your Department, Batch, and Section so your exams, notices, and classrooms link automatically.
            </p>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Department */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-emerald-600" /> Department
              </Label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              >
                {departmentNames.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            {/* Batch & Section Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-emerald-600" /> Batch
                </Label>
                <select
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                >
                  {batchNames.map((b) => (
                    <option key={b} value={b}>
                      Batch {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-emerald-600" /> Section
                </Label>
                <select
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                >
                  {sectionNames.map((s) => (
                    <option key={s} value={s}>
                      Section {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Student ID */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Student ID / Code (Optional)
              </Label>
              <Input
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
                placeholder="e.g. 0182220005101001"
                className="h-11 rounded-xl border-slate-200 bg-slate-50 text-sm font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
              <p className="text-[11px] text-slate-500">
                Your official University Student ID number.
              </p>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={saving}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold shadow-lg shadow-emerald-600/20 transition-all text-sm mt-2"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving Academic Setup...
                </>
              ) : (
                <>
                  Complete Setup <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
