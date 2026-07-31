"use client";

import { useEffect, useState, useCallback } from "react";
import { CourseDoc, BatchDoc, SectionDoc } from "@/lib/types";
import {
  getAllCourses,
  getAllBatches,
  getAllSections,
  subscribeToCourses,
} from "@/lib/academics/courseManagement";
import {
  DEFAULT_COURSES,
  DEFAULT_BATCHES,
  DEFAULT_SECTIONS,
  Course,
  Batch,
  Section,
} from "@/lib/academics/catalog";

export interface CatalogOption {
  id: string;
  name: string;
  code?: string;
}

export interface AcademicCatalog {
  courses: CourseDoc[];
  batches: BatchDoc[];
  sections: SectionDoc[];
  loading: boolean;
  refresh: () => Promise<void>;
  // Flat options for dropdowns (deduplicated names across the whole catalog)
  courseOptions: CatalogOption[];
  batchOptions: CatalogOption[];
  sectionOptions: CatalogOption[];
  // Batch/Section options scoped to a specific course/batch
  getBatchesForCourse: (courseId: string) => CatalogOption[];
  getSectionsForBatch: (batchId: string) => CatalogOption[];
}

/**
 * Convert a CourseDoc to a simple option.
 */
function toCourseOption(c: CourseDoc): CatalogOption {
  return { id: c.id, name: c.name, code: c.code };
}

function toBatchOption(b: BatchDoc): CatalogOption {
  return { id: b.id, name: b.name };
}

function toSectionOption(s: SectionDoc): CatalogOption {
  return { id: s.id, name: s.name };
}

/**
 * Real-time academic catalog hook.
 * Subscribes to Firestore courses and eagerly loads batches/sections.
 * Falls back to the static defaults when Firestore is empty/unavailable.
 */
export function useAcademicCatalog(): AcademicCatalog {
  const [courses, setCourses] = useState<CourseDoc[]>([]);
  const [batches, setBatches] = useState<BatchDoc[]>([]);
  const [sections, setSections] = useState<SectionDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBatchesSections = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([getAllBatches(), getAllSections()]);
      setBatches(b);
      setSections(s);
    } catch (error) {
      console.warn("[useAcademicCatalog] Failed to load batches/sections:", error);
    }
  }, []);

  useEffect(() => {
    let active = true;

    // Eagerly load batches & sections
    loadBatchesSections();

    // Subscribe to courses for real-time updates
    const unsubCourses = subscribeToCourses((courseDocs) => {
      if (!active) return;
      if (courseDocs.length > 0) {
        setCourses(courseDocs);
      } else {
        // Fallback to static defaults
        setCourses(
          DEFAULT_COURSES.map((c: Course) => ({
            id: c.id,
            name: c.name,
            code: c.code,
            departmentId: c.departmentId,
            departmentName: c.departmentName,
          } as CourseDoc))
        );
      }
      setLoading(false);
    });

    // Also ensure batches/sections have fallback data
    (async () => {
      try {
        const b = await getAllBatches();
        const s = await getAllSections();
        if (active) {
          setBatches(b.length > 0 ? b : DEFAULT_BATCHES.map((x: Batch) => ({
            id: x.id,
            courseId: "",
            name: x.name,
          } as BatchDoc)));
          setSections(s.length > 0 ? s : DEFAULT_SECTIONS.map((x: Section) => ({
            id: x.id,
            batchId: "",
            courseId: "",
            name: x.name,
          } as SectionDoc)));
          setLoading(false);
        }
      } catch (error) {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      unsubCourses();
    };
  }, [loadBatchesSections]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, b, s] = await Promise.all([getAllCourses(), getAllBatches(), getAllSections()]);
      setCourses(c.length > 0 ? c : DEFAULT_COURSES.map((x: Course) => ({ id: x.id, name: x.name, code: x.code, departmentId: x.departmentId, departmentName: x.departmentName } as CourseDoc)));
      setBatches(b.length > 0 ? b : DEFAULT_BATCHES.map((x: Batch) => ({ id: x.id, courseId: "", name: x.name } as BatchDoc)));
      setSections(s.length > 0 ? s : DEFAULT_SECTIONS.map((x: Section) => ({ id: x.id, batchId: "", courseId: "", name: x.name } as SectionDoc)));
    } catch (error) {
      console.warn("[useAcademicCatalog] Refresh failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const courseOptions = courses.map(toCourseOption);
  const batchOptions = batches.map(toBatchOption);
  const sectionOptions = sections.map(toSectionOption);

  const getBatchesForCourse = useCallback(
    (courseId: string): CatalogOption[] => {
      if (!courseId) return batchOptions;
      const scoped = batches.filter((b) => b.courseId === courseId).map(toBatchOption);
      // If no scoped batches found, return all as fallback (for legacy data)
      return scoped.length > 0 ? scoped : batchOptions;
    },
    [batches, batchOptions]
  );

  const getSectionsForBatch = useCallback(
    (batchId: string): CatalogOption[] => {
      if (!batchId) return sectionOptions;
      const scoped = sections.filter((s) => s.batchId === batchId).map(toSectionOption);
      // If no scoped sections found, return all as fallback
      return scoped.length > 0 ? scoped : sectionOptions;
    },
    [sections, sectionOptions]
  );

  return {
    courses,
    batches,
    sections,
    loading,
    refresh,
    courseOptions,
    batchOptions,
    sectionOptions,
    getBatchesForCourse,
    getSectionsForBatch,
  };
}

