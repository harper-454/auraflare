import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { setGeminiOAuthToken } from '../lib/ai-providers';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  logOut: async () => {}
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    // Ask for Gemini API access alongside identity so "sign in with Google"
    // doubles as the OAuth-first AI provider (see lib/ai-providers.ts). The
    // popup's access token is short-lived (~1h) — kept in sessionStorage and
    // dropped by the provider chain on 401/403.
    provider.addScope('https://www.googleapis.com/auth/generative-language');
    try {
      const result = await signInWithPopup(auth, provider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      if (cred?.accessToken) setGeminiOAuthToken(cred.accessToken);
    } catch (error) {
      console.error("Auth error", error);
    }
  };

  const logOut = async () => {
    setGeminiOAuthToken(null);
    await signOut(auth);
  };

  // Auth is optional and never blocks first paint. The app is fully usable
  // without signing in (chat runs local-first). Cloud-backed features mirror
  // to Firestore once `user` becomes non-null. Consumers can read `loading`
  // to show a subtle "syncing…" affordance if they want.
  return <AuthContext.Provider value={{ user, loading, signIn, logOut }}>{children}</AuthContext.Provider>;
};
