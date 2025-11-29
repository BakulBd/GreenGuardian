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
  const [user, setUser] = useState<User | null>(() => getCachedUser());
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let authCheckTimeout: NodeJS.Timeout | null = null;
    const hadPreviousSession = wasLoggedIn();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Clear any pending timeout
      if (authCheckTimeout) {
        clearTimeout(authCheckTimeout);
        authCheckTimeout = null;
      }

      if (!isMounted) return;

      if (firebaseUser) {
        try {
          // Fetch user data from Firestore
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          
          if (userDoc.exists() && isMounted) {
            const userData = { 
              ...userDoc.data(), 
              id: firebaseUser.uid 
            } as User;
            setUser(userData);
            setCachedUser(userData);
          } else if (isMounted) {
            // User in Auth but not in Firestore - keep cached if available
            const cached = getCachedUser();
            if (cached && cached.id === firebaseUser.uid) {
              setUser(cached);
            } else {
              setUser(null);
              setCachedUser(null);
            }
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
          if (isMounted) {
            // On error, use cached data if available
            const cached = getCachedUser();
            if (cached && cached.id === firebaseUser.uid) {
              setUser(cached);
            }
          }
        }
        
        if (isMounted) {
          setLoading(false);
          setInitialized(true);
        }
      } else {
        // No firebaseUser - but wait a bit if we had a previous session
        // Firebase might still be restoring from IndexedDB
        if (hadPreviousSession && !initialized) {
          authCheckTimeout = setTimeout(() => {
            if (isMounted) {
              // After waiting, if still no user, clear everything
              setUser(null);
              setCachedUser(null);
              setLoading(false);
              setInitialized(true);
            }
          }, 2000); // Wait 2 seconds for Firebase to restore session
        } else {
          // No previous session, immediately set to null
          if (isMounted) {
            setUser(null);
            setCachedUser(null);
            setLoading(false);
            setInitialized(true);
          }
        }
      }
    });

    return () => {
      isMounted = false;
      if (authCheckTimeout) {
        clearTimeout(authCheckTimeout);
      }
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
