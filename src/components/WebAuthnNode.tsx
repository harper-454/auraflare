import { useState, useEffect, useCallback } from 'react';
import { Fingerprint, ShieldCheck, Key, CheckCircle2, XCircle, Loader2, ScanFace } from 'lucide-react';

interface PasskeyRecord {
  id: string;
  createdAt: string;
  authenticator: string;
}

const STORAGE_KEY = 'aura-app-webauthn-credentials';

function loadKeys(): PasskeyRecord[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

export function WebAuthnNode() {
  // Real WebAuthn: navigator.credentials with your actual platform authenticator
  // (Windows Hello / Touch ID / security key)
  const [supported, setSupported] = useState<boolean | null>(null);
  const [platformAuth, setPlatformAuth] = useState<boolean | null>(null);
  const [keys, setKeys] = useState<PasskeyRecord[]>(loadKeys);
  const [busy, setBusy] = useState<'register' | 'verify' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    const ok = typeof window.PublicKeyCredential !== 'undefined';
    setSupported(ok);
    if (ok) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setPlatformAuth)
        .catch(() => setPlatformAuth(false));
    }
  }, []);

  const register = useCallback(async () => {
    setBusy('register');
    setMessage(null);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Aura Engine Spec', id: location.hostname },
          user: { id: userId, name: 'aura-local-user', displayName: 'Aura Local User' },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (cred) {
        const rec: PasskeyRecord = {
          id: cred.id,
          createdAt: new Date().toLocaleString(),
          authenticator: (cred.response as AuthenticatorAttestationResponse).getTransports?.().join(', ') || 'platform',
        };
        const next = [...keys, rec];
        setKeys(next);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setMessage({ kind: 'ok', text: 'Passkey created by your real authenticator and stored locally.' });
      }
    } catch (e: any) {
      setMessage({ kind: 'err', text: `${e.name}: ${e.message}` });
    }
    setBusy(null);
  }, [keys]);

  const verify = useCallback(async () => {
    setBusy('verify');
    setMessage(null);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;
      if (assertion) {
        setMessage({ kind: 'ok', text: `Assertion signed by credential ${assertion.id.slice(0, 12)}… — user verified.` });
      }
    } catch (e: any) {
      setMessage({ kind: 'err', text: `${e.name}: ${e.message}` });
    }
    setBusy(null);
  }, []);

  const removeKey = (id: string) => {
    const next = keys.filter(k => k.id !== id);
    setKeys(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Fingerprint className="text-indigo-400" /> WebAuthn / Passkeys
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          supported
            ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20'
            : 'text-rose-400 bg-rose-400/10 border-rose-500/20'
        }`}>
          {supported === null ? 'CHECKING…' : supported ? 'FIDO2 AVAILABLE' : 'NOT SUPPORTED'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
          <ScanFace className={`w-8 h-8 ${platformAuth ? 'text-emerald-400' : 'text-slate-600'}`} />
          <div>
            <div className="text-sm font-bold text-slate-200">Platform Authenticator</div>
            <div className="text-xs text-slate-500">
              {platformAuth === null ? 'Detecting…' : platformAuth ? 'Available (Hello / Touch ID)' : 'Not detected'}
            </div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
          <Key className="w-8 h-8 text-indigo-400" />
          <div>
            <div className="text-sm font-bold text-slate-200">{keys.length} Registered Passkey{keys.length === 1 ? '' : 's'}</div>
            <div className="text-xs text-slate-500">Credential IDs persisted locally</div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-indigo-500/10 border border-indigo-500/30 rounded-full flex items-center justify-center mb-6">
          <ShieldCheck className="w-10 h-10 text-indigo-400" />
        </div>
        <h3 className="text-2xl font-bold text-slate-200 mb-4">Passwordless Authentication</h3>
        <p className="text-slate-400 max-w-md mb-8">
          These buttons invoke the real Web Authentication API — your OS will prompt with Windows Hello, Touch ID, or a security key.
        </p>
        <div className="flex gap-3">
          <button
            onClick={register}
            disabled={!supported || busy !== null}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg flex items-center gap-2 font-bold transition-colors"
          >
            {busy === 'register' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Key className="w-5 h-5" />} Register Passkey
          </button>
          <button
            onClick={verify}
            disabled={!supported || busy !== null}
            className="px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg flex items-center gap-2 font-bold transition-colors"
          >
            {busy === 'verify' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Fingerprint className="w-5 h-5" />} Verify Identity
          </button>
        </div>
        {message && (
          <div className={`mt-6 flex items-center gap-2 text-sm ${message.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {message.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
            <span className="font-mono text-xs">{message.text}</span>
          </div>
        )}
      </div>

      {keys.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Registered Credentials</h3>
          <div className="space-y-2">
            {keys.map(k => (
              <div key={k.id} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-slate-300 truncate">{k.id}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{k.createdAt} · {k.authenticator}</div>
                </div>
                <button onClick={() => removeKey(k.id)} className="text-xs text-slate-500 hover:text-rose-400 shrink-0 ml-3">Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
