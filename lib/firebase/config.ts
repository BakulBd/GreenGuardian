import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth, connectAuthEmulator, browserLocalPersistence, setPersistence } from "firebase/auth";
import { getFirestore, Firestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, FirebaseStorage, connectStorageEmulator } from "firebase/storage";
import { getAnalytics, Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let storage: FirebaseStorage;
let analytics: Analytics | null = null;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  
  // Set auth persistence to local storage (survives browser refresh)
  if (typeof window !== "undefined") {
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.warn("Failed to set auth persistence:", error);
    });
    
    try {
      analytics = getAnalytics(app);
    } catch (e) {
      // Analytics may fail to initialize in some environments; ignore silently
    }
  }
  // If requested, connect to local emulators for development/testing
  if (process.env.USE_FIREBASE_EMULATOR === "true") {
    try {
      connectAuthEmulator(auth, "http://localhost:9099");
    } catch (e) {}
    try {
      connectFirestoreEmulator(db, "localhost", 8080);
    } catch (e) {}
    try {
      connectStorageEmulator(storage, "localhost", 9199);
    } catch (e) {}
  }
} else {
  app = getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  
  if (typeof window !== "undefined") {
    try {
      analytics = getAnalytics(app);
    } catch (e) {}
  }
  if (process.env.USE_FIREBASE_EMULATOR === "true") {
    try {
      connectAuthEmulator(auth, "http://localhost:9099");
    } catch (e) {}
    try {
      connectFirestoreEmulator(db, "localhost", 8080);
    } catch (e) {}
    try {
      connectStorageEmulator(storage, "localhost", 9199);
    } catch (e) {}
  }
}

export { app, auth, db, storage, analytics };
