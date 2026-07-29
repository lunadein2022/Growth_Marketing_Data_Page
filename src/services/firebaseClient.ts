import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

export type FirebaseDashboardUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
};

let app: FirebaseApp | null = null;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.storageBucket &&
      firebaseConfig.appId,
  );
}

function getFirebaseApp() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase config is missing. Check VITE_FIREBASE_* environment variables.");
  }

  if (!app) {
    app = initializeApp(firebaseConfig);
  }

  return app;
}

export function getFirebaseServices() {
  const firebaseApp = getFirebaseApp();

  return {
    auth: getAuth(firebaseApp),
    db: getFirestore(firebaseApp),
    storage: getStorage(firebaseApp),
  };
}

export function toDashboardUser(user: User | null): FirebaseDashboardUser | null {
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  };
}

export function subscribeToFirebaseUser(callback: (user: FirebaseDashboardUser | null) => void) {
  if (!hasFirebaseConfig()) {
    callback(null);
    return () => undefined;
  }

  const { auth } = getFirebaseServices();
  return onAuthStateChanged(auth, (user) => callback(toDashboardUser(user)));
}

export async function signInWithGoogle() {
  const { auth } = getFirebaseServices();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  return toDashboardUser(credential.user);
}

export async function signOutFromFirebase() {
  const { auth } = getFirebaseServices();
  await signOut(auth);
}
