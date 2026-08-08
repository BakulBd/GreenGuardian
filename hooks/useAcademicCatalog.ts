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
import { batchIdFor, sectionIdFor } from "@/lib/academics/ids";

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
  /**
   * Sections that belong to a given batch.
   *
   * Accepts either the batch's document id or its name — legacy assignments and
   * student profiles store the name, current catalog documents use a
   * name-derived id, and callers shouldn't have to care which they hold.
   */
  getSectionsForBatch: (batchIdOrName: string) => CatalogOption[];
  /** Section names for a batch, for value-by-name selects. */
  getSectionNamesForBatch: (batchIdOrName: string) => string[];
}

/**
 * Fallbacks used until the catalog is seeded into Firestore.
 *
 * These must be shaped exactly like real catalog documents — including the
 * batch link on every section — or the UI behaves differently before and after
 * seeding. Producing every section under every batch is what lets
 * getSectionsForBatch() answer correctly in the unseeded state.
 */
function fallbackBatches(): BatchDoc[] {
  return DEFAULT_BATCHES.map(
    (b: Batch) => ({ id: batchIdFor(b.name), name: b.name }) as BatchDoc
  );
}

function fallbackSections(): SectionDoc[] {
  return DEFAULT_BATCHES.flatMap((b: Batch) =>
    DEFAULT_SECTIONS.map(
      (s: Section) =>
        ({
          id: sectionIdFor(b.name, s.name),
          batchId: batchIdFor(b.name),
          batchName: b.name,
          name: s.name,
        }) as SectionDoc
    )
  );
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
          setBatches(b.length > 0 ? b : fallbackBatches());
          setSections(s.length > 0 ? s : fallbackSections());
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
      setBatches(b.length > 0 ? b : fallbackBatches());
      setSections(s.length > 0 ? s : fallbackSections());
    } catch (error) {
      console.warn("[useAcademicCatalog] Refresh failed:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const courseOptions = courses.map(toCourseOption);
  const batchOptions = batches.map(toBatchOption);
  const sectionOptions = sections.map(toSectionOption);

  const getSectionsForBatch = useCallback(
    (batchIdOrName: string): CatalogOption[] => {
      if (!batchIdOrName) return [];
      const key = batchIdOrName.trim().toLowerCase();
      // Match on id OR name: assignments and student profiles carry the name,
      // catalog documents carry a name-derived id, and both must resolve here.
      const scoped = sections.filter(
        (s) =>
          s.batchId?.toLowerCase() === key ||
          (s.batchName || "").toLowerCase() === key
      );
      // Legacy sections have no batch link at all. Falling back to every
      // section is wrong (it would offer 232's sections for batch 241), but so
      // is showing none, so fall back only when NOTHING in the catalog is
      // batch-linked — i.e. the pre-migration state.
      const anyLinked = sections.some((s) => s.batchId || s.batchName);
      const result = scoped.length > 0 ? scoped : anyLinked ? [] : sections;
      return result.map(toSectionOption);
    },
    [sections]
  );

  const getSectionNamesForBatch = useCallback(
    (batchIdOrName: string): string[] =>
      Array.from(new Set(getSectionsForBatch(batchIdOrName).map((s) => s.name))).sort(),
    [getSectionsForBatch]
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
    getSectionsForBatch,
    getSectionNamesForBatch,
  };
}

