"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import { User } from "@/lib/types";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  initialized: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  initialized: false,
});

// Storage key for caching user data
const USER_CACHE_KEY = "greenguardian_user_cache";
const AUTH_TOKEN_KEY = "greenguardian_auth_token";

// Get cached user from localStorage
function getCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Check if cache is less than 24 hours old
      if (parsed.timestamp && Date.now() - parsed.timestamp < 86400000) {
        return parsed.user;
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
}

// Cache user to localStorage
function setCachedUser(user: User | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
        user,
        timestamp: Date.now(),
      }));
      // Also set a simple token flag
      localStorage.setItem(AUTH_TOKEN_KEY, "true");
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch (e) {
    // Ignore storage errors
  }
}

// Check if user was previously logged in
function wasLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTH_TOKEN_KEY) === "true";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start with cached user if we were previously logged in
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const cached = getCachedUser();
    if (cached) {
      const validCachedRole = ["admin", "teacher", "student"].includes(cached.role) ? cached.role : "student";
      setUser({ ...cached, role: validCachedRole as any });
      setLoading(false);
      setInitialized(true);
    }
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;

      if (firebaseUser) {
        // Only show loading if we don't have a cached user to avoid blocking UI during background refresh
        if (isMounted && !cached) setLoading(true);
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          
          if (userDoc.exists() && isMounted) {
            const data = userDoc.data() || {};
            const validRole = ["admin", "teacher", "student"].includes(data.role) ? data.role : "student";
            const userData = { 
              ...data, 
              role: validRole,
              id: firebaseUser.uid 
            } as User;
            setUser(userData);
            setCachedUser(userData);
          } else if (isMounted) {
            const cached = getCachedUser();
            if (cached && cached.id === firebaseUser.uid) {
              const validCachedRole = ["admin", "teacher", "student"].includes(cached.role) ? cached.role : "student";
              setUser({ ...cached, role: validCachedRole as any });
            } else {
              // Construct fallback user object if doc missing
              const fallbackUser: User = {
                id: firebaseUser.uid,
                email: firebaseUser.email || "",
                name: firebaseUser.displayName || firebaseUser.email || "User",
                role: "student",
                approved: true,
                rejected: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              setUser(fallbackUser);
              setCachedUser(fallbackUser);
            }
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          if (isMounted) {
            const cached = getCachedUser();
            if (cached && cached.id === firebaseUser.uid) {
              const validCachedRole = ["admin", "teacher", "student"].includes(cached.role) ? cached.role : "student";
              setUser({ ...cached, role: validCachedRole as any });
            }
          }
        }
        
        if (isMounted) {
          setLoading(false);
          setInitialized(true);
        }
      } else {
        if (isMounted) {
          setUser(null);
          setCachedUser(null);
          setLoading(false);
          setInitialized(true);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // While loading, show cached user to prevent flicker
  const effectiveUser = loading ? (user || getCachedUser()) : user;

  return (
    <AuthContext.Provider value={{ user: effectiveUser, loading, initialized }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
