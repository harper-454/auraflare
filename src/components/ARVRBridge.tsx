import { useState, useEffect, useRef, useCallback } from 'react';
import { Headset, Eye, Maximize, Orbit, CheckCircle2, XCircle, Compass } from 'lucide-react';

interface XRSupport {
  api: boolean;
  vr: boolean | null;
  ar: boolean | null;
}

export function ARVRBridge() {
  // Real WebXR: live capability detection + real device orientation sensor demo.
  const [support, setSupport] = useState<XRSupport>({ api: false, vr: null, ar: null });
  const [xrError, setXrError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<{ alpha: number; beta: number; gamma: number } | null>(null);
  const [listening, setListening] = useState(false);
  const cubeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const xr = (navigator as any).xr;
    if (!xr) {
      setSupport({ api: false, vr: false, ar: false });
      return;
    }
    setSupport(s => ({ ...s, api: true }));
    xr.isSessionSupported('immersive-vr').then((vr: boolean) => setSupport(s => ({ ...s, vr }))).catch(() => setSupport(s => ({ ...s, vr: false })));
    xr.isSessionSupported('immersive-ar').then((ar: boolean) => setSupport(s => ({ ...s, ar }))).catch(() => setSupport(s => ({ ...s, ar: false })));
  }, []);

  const enterVR = useCallback(async () => {
    setXrError(null);
    try {
      const session = await (navigator as any).xr.requestSession('immersive-vr');
      // A real session opened — end it after a moment (no scene renderer attached here)
      setTimeout(() => session.end().catch(() => {}), 4000);
    } catch (e: any) {
      setXrError(`${e.name}: ${e.message}`);
    }
  }, []);

  // Real DeviceOrientation sensor (laptops/phones with gyro)
  const startOrientation = useCallback(async () => {
    const D = window.DeviceOrientationEvent as any;
    if (D?.requestPermission) {
      try { if ((await D.requestPermission()) !== 'granted') return; } catch { return; }
    }
    window.addEventListener('deviceorientation', e => {
      if (e.alpha === null && e.beta === null) return;
      const o = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
      setOrientation(o);
      if (cubeRef.current) {
        cubeRef.current.style.transform = `rotateX(${o.beta}deg) rotateY(${o.gamma}deg) rotateZ(${o.alpha / 4}deg)`;
      }
    });
    setListening(true);
  }, []);

  const Badge = ({ ok, label }: { ok: boolean | null; label: string }) => (
    <div className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
      <span className="text-sm text-slate-300">{label}</span>
      {ok === null
        ? <span className="text-xs text-slate-500 font-mono">checking…</span>
        : ok
          ? <span className="flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle2 className="w-4 h-4" /> supported</span>
          : <span className="flex items-center gap-1.5 text-xs text-slate-500"><XCircle className="w-4 h-4" /> unavailable</span>}
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Headset className="text-indigo-400" /> AR/VR Bridge
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          support.api ? 'text-indigo-400 bg-indigo-400/10 border-indigo-500/20' : 'text-slate-400 bg-slate-400/10 border-slate-500/20'
        }`}>
          {support.api ? 'WEBXR API PRESENT' : 'WEBXR NOT EXPOSED'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-500/50 flex items-center justify-center mb-6">
            <Orbit className="w-8 h-8 text-indigo-400" />
          </div>
          <h3 className="text-xl font-bold text-slate-200 mb-2">Capability Detection (live)</h3>
          <div className="w-full space-y-2 mb-6 text-left">
            <Badge ok={support.api} label="navigator.xr" />
            <Badge ok={support.vr} label="immersive-vr session" />
            <Badge ok={support.ar} label="immersive-ar session" />
          </div>
          <button
            onClick={enterVR}
            disabled={!support.vr}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg flex items-center gap-2 font-bold transition-colors w-full justify-center"
          >
            <Eye className="w-5 h-5" /> {support.vr ? 'Enter VR (real session)' : 'No headset detected'}
          </button>
          {xrError && <p className="mt-3 text-xs font-mono text-rose-400">{xrError}</p>}
          {support.api && support.vr === false && (
            <p className="mt-3 text-xs text-slate-500">Connect a WebXR headset (Quest via Link, etc.) and revisit — detection is live.</p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-slate-950 rounded flex items-center justify-center shrink-0 border border-slate-800">
              <Compass className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold text-slate-200">Orientation Sensor</div>
              <div className="text-xs text-slate-500">Real gyroscope via DeviceOrientationEvent</div>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center py-6" style={{ perspective: '600px' }}>
            <div
              ref={cubeRef}
              className="w-24 h-24 border-2 border-indigo-500/60 bg-indigo-500/10 rounded-lg transition-transform duration-100 flex items-center justify-center"
              style={{ transformStyle: 'preserve-3d' }}
            >
              <Maximize className="w-8 h-8 text-indigo-400" />
            </div>
          </div>

          {orientation ? (
            <div className="grid grid-cols-3 gap-2 font-mono text-xs text-center">
              <div className="bg-slate-950 border border-slate-800 rounded p-2">
                <div className="text-slate-500">α</div><div className="text-indigo-400">{orientation.alpha.toFixed(1)}°</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2">
                <div className="text-slate-500">β</div><div className="text-indigo-400">{orientation.beta.toFixed(1)}°</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded p-2">
                <div className="text-slate-500">γ</div><div className="text-indigo-400">{orientation.gamma.toFixed(1)}°</div>
              </div>
            </div>
          ) : (
            <button
              onClick={startOrientation}
              disabled={listening}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded text-sm font-medium transition-colors"
            >
              {listening ? 'No gyro data — device has no sensor' : 'Start sensor stream'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
