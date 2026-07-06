import { useState, useEffect, useCallback } from 'react';
import { Users, KeyRound, ShieldAlert, LogIn, LogOut, RefreshCw, Loader2 } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User, getIdTokenResult, IdTokenResult } from 'firebase/auth';
import { auth } from '../lib/firebase';

export function IdentityProvider() {
  // Real IAM: live Firebase Auth session, real Google OAuth, real decoded ID token claims
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<IdTokenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      setUser(u);
      setToken(u ? await getIdTokenResult(u).catch(() => null) : null);
    });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e: any) {
      setError(`${e.code ?? e.name}: ${e.message}`);
    }
    setBusy(false);
  }, []);

  const refreshToken = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      await user.getIdToken(true); // force refresh against Google's token endpoint
      setToken(await getIdTokenResult(user));
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  }, [user]);

  const expiresIn = token ? Math.max(0, Math.round((new Date(token.expirationTime).getTime() - Date.now()) / 60000)) : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Users className="text-indigo-400" /> Identity & Access (IAM)
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          user ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' : 'text-indigo-400 bg-indigo-400/10 border-indigo-500/20'
        }`}>
          {user ? 'OIDC SESSION ACTIVE' : 'NO SESSION'}
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-indigo-400" /> Session
            </h3>

            {user ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-slate-950 border border-slate-800 rounded-lg">
                  {user.photoURL && <img src={user.photoURL} alt="" className="w-12 h-12 rounded-full border border-slate-700" referrerPolicy="no-referrer" />}
                  <div className="min-w-0">
                    <div className="font-bold text-slate-200 truncate">{user.displayName ?? 'Anonymous'}</div>
                    <div className="text-xs text-slate-500 font-mono truncate">{user.email}</div>
                    <div className="text-[10px] text-slate-600 font-mono mt-1 truncate">uid: {user.uid}</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={refreshToken}
                    disabled={busy}
                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh Token
                  </button>
                  <button
                    onClick={() => signOut(auth)}
                    className="flex-1 px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/50 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-slate-950 border border-slate-800 rounded-lg text-center">
                <p className="text-sm text-slate-400 mb-4">No identity session. Sign in with your real Google account via Firebase Auth.</p>
                <button
                  onClick={signIn}
                  disabled={busy}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-bold transition-colors flex items-center gap-2 mx-auto"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />} Sign in with Google
                </button>
              </div>
            )}
            {error && <p className="mt-3 text-xs font-mono text-rose-400 break-all">{error}</p>}
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-200 mb-6 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" /> ID Token Claims (decoded live)
            </h3>
            {token ? (
              <div className="space-y-3">
                <div className="bg-slate-950 p-4 rounded border border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium text-slate-200">Token Expiry</span>
                    <span className={`text-xs font-mono border px-2 py-0.5 rounded ${
                      (expiresIn ?? 0) < 10 ? 'text-amber-400 border-amber-500/40' : 'text-emerald-400 border-emerald-500/40'
                    }`}>
                      {expiresIn} MIN
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Issued {new Date(token.issuedAtTime).toLocaleTimeString()} · provider: {token.signInProvider}</p>
                </div>
                <div className="bg-slate-950 p-4 rounded border border-slate-800 max-h-56 overflow-y-auto">
                  <div className="text-xs font-bold text-slate-400 mb-2">JWT payload</div>
                  <pre className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap break-all">
                    {JSON.stringify(token.claims, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 p-6 rounded border border-slate-800 text-sm text-slate-500">
                Sign in to inspect the real JWT issued by Google — audience, issuer, expiry, and identity claims, decoded client-side.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
