import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// Violation type definitions with score penalties
export interface ViolationPenalties {
  tabSwitch: number;         // Switching tabs
  fullscreenExit: number;    // Exiting fullscreen
  noFace: number;            // No face detected
  multipleFaces: number;     // Multiple faces detected
  lookingAway: number;       // Looking away from screen
  copyAttempt: number;       // Copy attempt
  pasteAttempt: number;      // Paste attempt
  rightClick: number;        // Right-click attempt
  suspiciousKeyboard: number; // Suspicious keyboard shortcut
  windowBlur: number;        // Window lost focus
  multipleWindows: number;   // Multiple exam windows
  mobilePhoneDetected: number; // Mobile phone in view
  bookDetected: number;      // Book/study material in view
  additionalDevice: number;  // Additional laptop/device
  secondPerson: number;      // Another person in view
}

// Default penalties (can be customized per exam) - Practical real-world values
// More lenient for accidental behaviors, strict for obvious cheating
export const DEFAULT_PENALTIES: ViolationPenalties = {
  tabSwitch: 3,           // Might be accidental notification
  fullscreenExit: 2,      // Often accidental on mobile
  noFace: 1,              // Could be technical issue or looking at papers
  multipleFaces: 10,      // Serious concern - another person
  lookingAway: 1,         // Could be thinking or reading question
  copyAttempt: 4,         // Deliberate action but blocked anyway
  pasteAttempt: 5,        // More serious
  rightClick: 0,          // Just silently blocked, no penalty
  suspiciousKeyboard: 3,  // Could be habit
  windowBlur: 2,          // Could be notification popup
  multipleWindows: 10,    // Deliberate action
  mobilePhoneDetected: 15, // Very serious - cheating attempt
  bookDetected: 8,        // Cheating with study material
  additionalDevice: 12,   // Using secondary device
  secondPerson: 15,       // Getting help from someone
};

// Map warning reasons to violation types
export function getViolationType(reason: string): keyof ViolationPenalties | null {
  const reasonLower = reason.toLowerCase();
  
  if (reasonLower.includes("tab switch")) return "tabSwitch";
  if (reasonLower.includes("fullscreen")) return "fullscreenExit";
  if (reasonLower.includes("no face")) return "noFace";
  if (reasonLower.includes("multiple face")) return "multipleFaces";
  if (reasonLower.includes("looking away")) return "lookingAway";
  if (reasonLower.includes("copy")) return "copyAttempt";
  if (reasonLower.includes("paste")) return "pasteAttempt";
  if (reasonLower.includes("right-click")) return "rightClick";
  if (reasonLower.includes("keyboard")) return "suspiciousKeyboard";
  if (reasonLower.includes("focus") || reasonLower.includes("blur")) return "windowBlur";
  if (reasonLower.includes("multiple") && reasonLower.includes("window")) return "multipleWindows";
  if (reasonLower.includes("mobile phone") || reasonLower.includes("cell phone")) return "mobilePhoneDetected";
  if (reasonLower.includes("book") || reasonLower.includes("study material")) return "bookDetected";
  if (reasonLower.includes("additional") && (reasonLower.includes("laptop") || reasonLower.includes("device"))) return "additionalDevice";
  if (reasonLower.includes("additional person") || reasonLower.includes("second person")) return "secondPerson";
  
  return null;
}

// Calculate behavior score (starts at 100, deducted for violations)
export interface ViolationCounts {
  tabSwitch: number;
  fullscreenExit: number;
  noFace: number;
  multipleFaces: number;
  lookingAway: number;
  copyAttempt: number;
  pasteAttempt: number;
  rightClick: number;
  suspiciousKeyboard: number;
  windowBlur: number;
  multipleWindows: number;
  mobilePhoneDetected: number;
  bookDetected: number;
  additionalDevice: number;
  secondPerson: number;
}

// Calculate practical behavior score with diminishing returns for repeated violations
export function calculateBehaviorScore(
  violations: ViolationCounts,
  penalties: ViolationPenalties = DEFAULT_PENALTIES
): number {
  let totalPenalty = 0;
  
  // Helper to calculate penalty with diminishing returns
  const calcPenalty = (count: number, basePenalty: number): number => {
    let penalty = 0;
    for (let i = 0; i < count; i++) {
      // Each subsequent violation is worth less (first is 100%, second is 85%, etc.)
      const multiplier = Math.max(0.5, 1 - i * 0.15);
      penalty += basePenalty * multiplier;
    }
    return penalty;
  };
  
  // Calculate penalties for each violation type
  totalPenalty += calcPenalty(violations.tabSwitch, penalties.tabSwitch);
  totalPenalty += calcPenalty(violations.fullscreenExit, penalties.fullscreenExit);
  totalPenalty += calcPenalty(violations.noFace, penalties.noFace);
  totalPenalty += calcPenalty(violations.multipleFaces, penalties.multipleFaces);
  totalPenalty += calcPenalty(violations.lookingAway, penalties.lookingAway);
  totalPenalty += calcPenalty(violations.copyAttempt, penalties.copyAttempt);
  totalPenalty += calcPenalty(violations.pasteAttempt, penalties.pasteAttempt);
  totalPenalty += calcPenalty(violations.rightClick, penalties.rightClick);
  totalPenalty += calcPenalty(violations.suspiciousKeyboard, penalties.suspiciousKeyboard);
  totalPenalty += calcPenalty(violations.windowBlur, penalties.windowBlur);
  totalPenalty += calcPenalty(violations.multipleWindows, penalties.multipleWindows);
  totalPenalty += calcPenalty(violations.mobilePhoneDetected, penalties.mobilePhoneDetected);
  totalPenalty += calcPenalty(violations.bookDetected, penalties.bookDetected);
  totalPenalty += calcPenalty(violations.additionalDevice, penalties.additionalDevice);
  totalPenalty += calcPenalty(violations.secondPerson, penalties.secondPerson);
  
  // Ensure score doesn't go below 0
  return Math.max(0, Math.round(100 - totalPenalty));
}

// Initialize empty violation counts
export function initializeViolationCounts(): ViolationCounts {
  return {
    tabSwitch: 0,
    fullscreenExit: 0,
    noFace: 0,
    multipleFaces: 0,
    lookingAway: 0,
    copyAttempt: 0,
    pasteAttempt: 0,
    rightClick: 0,
    suspiciousKeyboard: 0,
    windowBlur: 0,
    multipleWindows: 0,
    mobilePhoneDetected: 0,
    bookDetected: 0,
    additionalDevice: 0,
    secondPerson: 0,
  };
}

// Get violation summary for display
export function getViolationSummary(violations: ViolationCounts): string[] {
  const summary: string[] = [];
  
  if (violations.mobilePhoneDetected > 0) 
    summary.push(`📱 Mobile phone detected: ${violations.mobilePhoneDetected}x`);
  if (violations.secondPerson > 0) 
    summary.push(`👥 Additional person: ${violations.secondPerson}x`);
  if (violations.bookDetected > 0) 
    summary.push(`📚 Study material: ${violations.bookDetected}x`);
  if (violations.additionalDevice > 0) 
    summary.push(`💻 Additional device: ${violations.additionalDevice}x`);
  if (violations.multipleFaces > 0) 
    summary.push(`👤 Multiple faces: ${violations.multipleFaces}x`);
  if (violations.multipleWindows > 0) 
    summary.push(`🪟 Multiple windows: ${violations.multipleWindows}x`);
  if (violations.tabSwitch > 0) 
    summary.push(`🔄 Tab switches: ${violations.tabSwitch}x`);
  if (violations.noFace > 0) 
    summary.push(`❌ Face not visible: ${violations.noFace}x`);
  if (violations.lookingAway > 0) 
    summary.push(`👀 Looking away: ${violations.lookingAway}x`);
  if (violations.fullscreenExit > 0) 
    summary.push(`⛶ Fullscreen exits: ${violations.fullscreenExit}x`);
  if (violations.copyAttempt > 0) 
    summary.push(`📋 Copy attempts: ${violations.copyAttempt}x`);
  if (violations.pasteAttempt > 0) 
    summary.push(`📋 Paste attempts: ${violations.pasteAttempt}x`);
  if (violations.windowBlur > 0) 
    summary.push(`🔍 Window lost focus: ${violations.windowBlur}x`);
    
  return summary;
}

export function calculateRiskScore(logs: any[]): number {
  let score = 0;
  logs.forEach((log) => {
    if (log.type === "tab_switch") score += 10;
    if (log.type === "fullscreen_exit") score += 15;
    if (log.type === "no_face") score += 20;
    if (log.type === "multiple_faces") score += 25;
    if (log.type === "attention_away") score += 5;
  });
  return Math.min(score, 100);
}

export function getRiskLevel(score: number): { level: string; color: string } {
  if (score < 20) return { level: "Low", color: "text-green-600" };
  if (score < 50) return { level: "Medium", color: "text-yellow-600" };
  if (score < 75) return { level: "High", color: "text-orange-600" };
  return { level: "Critical", color: "text-red-600" };
}

// Get behavior score level (based on 0-100 score where 100 is best)
export function getBehaviorLevel(score: number): { level: string; color: string; badge: string } {
  if (score >= 90) return { level: "Excellent", color: "text-green-600", badge: "bg-green-100 text-green-800" };
  if (score >= 75) return { level: "Good", color: "text-blue-600", badge: "bg-blue-100 text-blue-800" };
  if (score >= 50) return { level: "Fair", color: "text-yellow-600", badge: "bg-yellow-100 text-yellow-800" };
  if (score >= 25) return { level: "Poor", color: "text-orange-600", badge: "bg-orange-100 text-orange-800" };
  return { level: "Critical", color: "text-red-600", badge: "bg-red-100 text-red-800" };
}
