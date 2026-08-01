"use client";

import { useRef, useState, useEffect, useCallback, ClipboardEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/**
 * A polished 6-box OTP input with auto-advance, backspace navigation,
 * paste support, and number-only filtering.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  disabled = false,
  error = false,
  autoFocus = false,
  className,
}: OtpInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Normalize value to digits only.
  const digits = value.replace(/\D/g, "").slice(0, length).split("");

  const setDigitAt = useCallback(
    (index: number, char: string) => {
      const next = value.replace(/\D/g, "").slice(0, length).split("");
      next[index] = char;
      onChange(next.join("").slice(0, length));
    },
    [onChange, value, length]
  );

  useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const focusIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < length) {
        inputRefs.current[index]?.focus();
        inputRefs.current[index]?.select();
      }
    },
    [length]
  );

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Only allow digits.
    const digit = raw.replace(/\D/g, "").slice(-1);
    setDigitAt(index, digit);
    if (digit && index < length - 1) {
      focusIndex(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const current = value.replace(/\D/g, "").slice(0, length).split("");
      if (current[index]) {
        // Clear current box.
        current[index] = "";
        onChange(current.join(""));
      } else if (index > 0) {
        // Move to previous box.
        current[index - 1] = "";
        onChange(current.join(""));
        focusIndex(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusIndex(index - 1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusIndex(index + 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Allow form submit.
      const form = inputRefs.current[index]?.closest("form");
      form?.requestSubmit();
      return;
    }
  };

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    const current = value.replace(/\D/g, "").slice(0, length).split("");
    for (let i = 0; i < pasted.length; i++) {
      const target = index + i;
      if (target >= length) break;
      current[target] = pasted[i];
    }
    onChange(current.join(""));
    // Focus the box right after the pasted content.
    focusIndex(Math.min(index + pasted.length, length - 1));
  };

  return (
    <div className={cn("flex items-center justify-center gap-2 sm:gap-3", className)}>
      {Array.from({ length }).map((_, index) => {
        const hasValue = !!digits[index];
        const isFocused = focusedIndex === index;
        return (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={2}
            value={digits[index] || ""}
            disabled={disabled}
            onChange={(e) => handleChange(index, e)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={(e) => handlePaste(index, e)}
            onFocus={() => setFocusedIndex(index)}
            onBlur={() => setFocusedIndex(-1)}
            aria-label={`Digit ${index + 1}`}
            className={cn(
              "w-11 h-12 sm:w-13 sm:h-14 md:w-14 md:h-16 text-center text-xl sm:text-2xl font-bold rounded-xl border-2 transition-all duration-200 outline-none bg-white",
              "focus:ring-4 focus:ring-green-500/15",
              error && !hasValue
                ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                : isFocused
                ? "border-green-500 shadow-lg shadow-green-500/10 scale-105"
                : "border-gray-200 hover:border-gray-300",
              hasValue && !error && "border-green-400 bg-green-50/50 text-green-800",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          />
        );
      })}
    </div>
  );
}

