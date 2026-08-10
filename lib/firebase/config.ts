import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import {
  getAuth,
  Auth,
  connectAuthEmulator,
  browserLocalPersistence,
  setPersistence,
} from "firebase/auth";
import { getFirestore, Firestore, connectFirestoreEmulator } from "firebase/firestore";
import type { Analytics } from "firebase/analytics";

/**
 * Firebase web configuration.
 *
 * These values are public by design — they identify the project, they are not
 * credentials. Access is controlled by the Firestore security rules.
 * The literals below keep the app working if the env vars are not set; provide
 * NEXT_PUBLIC_FIREBASE_* in the hosting environment to point at another project.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyCDeNhPVZpuRd7I28Oh_Csc_XshcuXrKgk",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "greenguardian2026.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "greenguardian2026",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1066634347018",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1066634347018:web:df7fc3be32bb1b18d195f3",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-1EVBQX5J7V",
};

// A single initialization path — the previous version duplicated the whole
// setup in an if/else and could connect the emulators twice.
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth: Auth = getAuth(app);
const db: Firestore = getFirestore(app);

let analytics: Analytics | null = null;

/**
 * Emulator wiring.
 * Must be NEXT_PUBLIC_ — a bare server variable is `undefined` in the browser,
 * so the old `USE_FIREBASE_EMULATOR` check never fired on the client.
 */
const useEmulator =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" ||
  process.env.USE_FIREBASE_EMULATOR === "true";

if (typeof window !== "undefined") {
  const globalScope = window as typeof window & { __ggFirebaseReady?: boolean };

  if (!globalScope.__ggFirebaseReady) {
    globalScope.__ggFirebaseReady = true;

    // Keep the session across reloads (exam refresh, tab restore).
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.warn("Failed to set auth persistence:", error);
    });

    if (useEmulator) {
      try {
        connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
        connectFirestoreEmulator(db, "localhost", 8080);
      } catch (error) {
        console.warn("Failed to connect Firebase emulators:", error);
      }
    } else {
      // Analytics is optional and adds ~40KB — load it lazily and never let it
      // break the app (it throws on unsupported browsers and in private mode).
      import("firebase/analytics")
        .then(async ({ getAnalytics, isSupported }) => {
          if (await isSupported()) analytics = getAnalytics(app);
        })
        .catch(() => {
          /* analytics is non-essential */
        });
    }
  }
}

export { app, auth, db, analytics };
