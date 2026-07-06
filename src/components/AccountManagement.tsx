import React, { useState, useEffect, useCallback } from 'react';
import { UserCircle, Shield, Key, History, LogOut, LogIn, CloudDownload, Loader2, Check } from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, updateProfile, User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { StorageService } from '../lib/storage';

interface ApiKey {
  id: string;
  label: string;
  key: string;
  createdAt: string;
}

const KEYS_STORAGE = 'aura-app-api-keys';
const loadKeys = (): ApiKey[] => { try { return JSON.parse(localStorage.getItem(KEYS_STORAGE) ?? '[]'); } catch { return []; } };

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return 'aura_live_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const AccountManagement = () => {
  // Real account: live Firebase Auth session, real profile updates,
  // crypto-random API keys persisted locally, real cloud sync
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [keys, setKeys] = useState<ApiKey[]>(loadKeys);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'busy' | 'done' | 'none'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setLoading(false); }), []);

  const saveKeys = (next: ApiKey[]) => { setKeys(next); localStorage.setItem(KEYS_STORAGE, JSON.stringify(next)); };

  const createKey = useCallback(() => {
    const key = generateKey();
    setNewKey(key);
    saveKeys([...keys, { id: crypto.randomUUID(), label: `Key ${keys.length + 1}`, key: key.slice(0, 12) + '…' + key.slice(-4), createdAt: new Date().toLocaleDateString() }]);
  }, [keys]);

  const saveName = useCallback(async () => {
    if (!user || !nameDraft.trim()) return;
    try {
      await updateProfile(user, { displayName: nameDraft.trim() });
      setUser({ ...user, displayName: nameDraft.trim() } as User);
      setEditingName(false);
    } catch (e: any) { setError(e.message); }
  }, [user, nameDraft]);

  const syncCloud = useCallback(async () => {
    setSyncState('busy');
    const synced = await StorageService.syncFromCloud();
    setSyncState(synced ? 'done' : 'none');
  }, []);

  const initials = user?.displayName?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '??';

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-slate-800 flex items-center px-6 bg-slate-900/50 backdrop-blur z-10 sticky top-0 rounded-t-xl">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-3">
          <UserCircle className="text-fuchsia-400" /> Account Management
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-10 max-w-5xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center gap-3 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> Checking session…</div>
        ) : !user ? (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-10 text-center max-w-md mx-auto">
            <UserCircle className="w-16 h-16 text-slate-700 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-200 mb-2">Not signed in</h3>
            <p className="text-sm text-slate-400 mb-6">Sign in with Google to load your real account.</p>
            <button
              onClick={() => signInWithPopup(auth, new GoogleAuthProvider()).catch(e => setError(e.message))}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold transition-colors flex items-center gap-2 mx-auto"
            >
              <LogIn className="w-5 h-5" /> Sign in with Google
            </button>
            {error && <p className="mt-4 text-xs font-mono text-rose-400 break-all">{error}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="col-span-1 space-y-6">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 flex flex-col items-center text-center">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="w-24 h-24 rounded-full border-2 border-fuchsia-500/40 mb-4 shadow-xl shadow-fuchsia-500/10" />
                ) : (
                  <div className="w-24 h-24 bg-gradient-to-tr from-fuchsia-600 to-indigo-600 rounded-full flex items-center justify-center text-3xl font-bold text-white mb-4">{initials}</div>
                )}
                {editingName ? (
                  <div className="flex gap-2 mb-1 w-full">
                    <input
                      value={nameDraft}
                      onChange={e => setNameDraft(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                      autoFocus
                    />
                    <button onClick={saveName} className="px-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white"><Check className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <h3 className="text-xl font-bold text-slate-100 mb-1">{user.displayName ?? 'Anonymous'}</h3>
                )}
                <p className="text-sm text-slate-400 mb-2">{user.email}</p>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400 rounded-full text-xs font-bold uppercase tracking-wider mb-4">
                  <Shield className="w-3 h-3" /> {user.emailVerified ? 'Verified' : 'Unverified'}
                </div>
                <button
                  onClick={() => { setEditingName(true); setNameDraft(user.displayName ?? ''); }}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-slate-100 rounded-lg text-sm font-bold border border-slate-700 transition-colors"
                >
                  Edit Display Name
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <button
                  onClick={() => signOut(auth)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-900 rounded-lg transition-colors text-left text-sm font-bold text-rose-400 hover:text-rose-300"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>

            <div className="col-span-1 lg:col-span-2 space-y-8">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                  <History className="text-slate-400" /> Session Metadata (from Firebase)
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                    <div className="text-xs text-slate-500 mb-1">Account Created</div>
                    <div className="text-slate-200 font-mono text-xs">{user.metadata.creationTime}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                    <div className="text-xs text-slate-500 mb-1">Last Sign-In</div>
                    <div className="text-slate-200 font-mono text-xs">{user.metadata.lastSignInTime}</div>
                  </div>
                </div>
                <button
                  onClick={syncCloud}
                  disabled={syncState === 'busy'}
                  className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-100 rounded-lg text-sm font-bold transition-colors flex items-center gap-2"
                >
                  {syncState === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
                  {syncState === 'done' ? 'Synced from Firestore ✓' : syncState === 'none' ? 'No cloud data found' : 'Pull data from Firestore'}
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
                <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
                  <Key className="text-slate-400" /> API Keys
                </h3>
                <p className="text-sm text-slate-400 mb-4">Crypto-random keys (generated with your browser's CSPRNG) for the local Aura gateway. Stored on this device only.</p>
                {newKey && (
                  <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                    <div className="text-xs text-amber-400 font-bold mb-1">Copy now — shown once:</div>
                    <code className="text-xs font-mono text-slate-200 break-all">{newKey}</code>
                  </div>
                )}
                <div className="space-y-3">
                  {keys.length === 0 && <p className="text-xs text-slate-600">No keys yet.</p>}
                  {keys.map(k => (
                    <div key={k.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-bold text-slate-200 mb-1">{k.label} <span className="text-[10px] text-slate-600 font-normal">· {k.createdAt}</span></div>
                        <div className="text-xs font-mono text-slate-500">{k.key}</div>
                      </div>
                      <button
                        onClick={() => saveKeys(keys.filter(x => x.id !== k.id))}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-rose-600/30 hover:text-rose-400 text-slate-300 text-xs font-bold rounded transition-colors"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={createKey}
                  className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-100 rounded-lg text-sm font-bold transition-colors"
                >
                  Generate New Key
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
