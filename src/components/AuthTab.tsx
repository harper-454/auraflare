import React, { useState, useEffect } from 'react';
import { auth } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { StorageService } from '../lib/storage';
import { Loader2, Cloud, CloudOff, LogIn, UserPlus, LogOut, RefreshCw } from 'lucide-react';

export const AuthTab = () => {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        handleSync();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleSync = async () => {
    setSyncing(true);
    const hasData = await StorageService.syncFromCloud();
    setSyncing(false);
    if (hasData) {
      window.location.reload(); // Reload to reflect synced data
    }
  };

  if (user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-slate-300">
        <div className="bg-slate-900 border border-indigo-500/30 rounded-xl p-8 max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-500/50">
            <Cloud className="w-8 h-8 text-indigo-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Cloud Sync Active</h2>
          <p className="text-slate-400 text-sm">
            Logged in as <span className="text-indigo-300 font-medium">{user.email}</span>
          </p>
          <div className="bg-slate-800/50 rounded-lg p-4 text-sm text-left border border-slate-700/50">
            <p className="mb-2 text-slate-300">Your session is automatically synced to the cloud.</p>
            <ul className="list-disc list-inside text-slate-400 space-y-1">
              <li>Project Vision & Requirements</li>
              <li>Tasks & Roadmap</li>
              <li>3D Viewport Configuration</li>
              <li>IDE Workspaces</li>
            </ul>
          </div>
          <div className="flex gap-4 justify-center pt-4">
            <button 
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Force Sync
            </button>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-slate-300">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-700">
            <CloudOff className="w-8 h-8 text-slate-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Cloud Saving</h2>
          <p className="text-slate-400 text-sm mt-2">
            Sign in to automatically sync your workspace across devices.
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              required
            />
          </div>
          
          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button 
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors disabled:opacity-50 mt-4"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isLogin ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />)}
            {isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="text-center pt-4 border-t border-slate-800">
          <button 
            onClick={() => setIsLogin(!isLogin)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
};
