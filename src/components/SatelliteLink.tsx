import { useState, useEffect, useRef } from 'react';
import { Satellite, Signal, Radio, Earth, Activity } from 'lucide-react';

interface IssData {
  latitude: number;
  longitude: number;
  altitude: number;   // km
  velocity: number;   // km/h
  visibility: string;
  timestamp: number;
}

// Live ISS telemetry — real orbital data from wheretheiss.at (NORAD 25544)
const ISS_API = 'https://api.wheretheiss.at/v1/satellites/25544';

export function SatelliteLink() {
  const [iss, setIss] = useState<IssData | null>(null);
  const [trail, setTrail] = useState<{ lat: number; lon: number }[]>([]);
  const [apiMs, setApiMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      if (busy.current) return;
      busy.current = true;
      const t0 = performance.now();
      try {
        const res = await fetch(ISS_API);
        const data: IssData = await res.json();
        if (mounted) {
          setApiMs(Math.round(performance.now() - t0));
          setIss(data);
          setTrail(t => [...t.slice(-59), { lat: data.latitude, lon: data.longitude }]);
          setError(null);
        }
      } catch (e: any) {
        if (mounted) setError(`Uplink failed: ${e.message}`);
      } finally {
        busy.current = false;
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Equirectangular projection onto the 360×180 SVG map
  const toXY = (lat: number, lon: number) => ({ x: lon + 180, y: 90 - lat });
  const pos = iss ? toXY(iss.latitude, iss.longitude) : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Satellite className="text-indigo-400" /> LEO Satellite Tracking
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          error ? 'text-rose-400 bg-rose-400/10 border-rose-500/20' : 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20'
        }`}>
          {error ? 'LINK DOWN' : 'ISS LIVE FEED · NORAD 25544'}
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/10 via-slate-900 to-slate-950 pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center shadow-[0_0_30px_rgba(123,140,250,0.15)] shrink-0">
              <Earth className="w-7 h-7 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-200">International Space Station — live position</h3>
              <p className="text-slate-400 text-sm">
                Real orbital telemetry polled every 3 seconds from wheretheiss.at.
                {iss && ` Currently ${iss.visibility === 'daylight' ? 'in daylight' : 'in Earth’s shadow'}.`}
              </p>
            </div>
          </div>

          {error && <div className="p-3 mb-4 bg-rose-500/10 border border-rose-500/30 rounded text-xs font-mono text-rose-400">{error}</div>}

          {/* Ground track map */}
          <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden mb-6">
            <svg viewBox="0 0 360 180" className="w-full block">
              {/* graticule */}
              {Array.from({ length: 11 }, (_, i) => (
                <line key={`v${i}`} x1={i * 36} y1={0} x2={i * 36} y2={180} stroke="#161a22" strokeWidth={0.5} />
              ))}
              {Array.from({ length: 5 }, (_, i) => (
                <line key={`h${i}`} x1={0} y1={(i + 1) * 30} x2={360} y2={(i + 1) * 30} stroke="#161a22" strokeWidth={0.5} />
              ))}
              <line x1={0} y1={90} x2={360} y2={90} stroke="#242a35" strokeWidth={0.7} />
              {/* ground trail */}
              {trail.map((p, i) => {
                const { x, y } = toXY(p.lat, p.lon);
                return <circle key={i} cx={x} cy={y} r={0.9} fill="#7b8cfa" opacity={(i + 1) / trail.length * 0.7} />;
              })}
              {/* current position */}
              {pos && (
                <>
                  <circle cx={pos.x} cy={pos.y} r={6} fill="none" stroke="#7b8cfa" strokeWidth={0.8} opacity={0.5}>
                    <animate attributeName="r" values="4;9;4" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={pos.x} cy={pos.y} r={2.5} fill="#e2e6ee" stroke="#7b8cfa" strokeWidth={1} />
                </>
              )}
            </svg>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-center">
              <Signal className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
              <div className="text-xl font-bold text-slate-200">
                {iss ? `${iss.latitude.toFixed(2)}°, ${iss.longitude.toFixed(2)}°` : '—'}
              </div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Lat / Lon</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-center">
              <Radio className="w-5 h-5 text-indigo-400 mx-auto mb-2" />
              <div className="text-xl font-bold text-slate-200">{iss ? `${(iss.velocity).toFixed(0)}` : '—'}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">km/h Orbital</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-center">
              <Satellite className="w-5 h-5 text-amber-400 mx-auto mb-2" />
              <div className="text-xl font-bold text-slate-200">{iss ? `${iss.altitude.toFixed(1)}` : '—'}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">km Altitude</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-center">
              <Activity className="w-5 h-5 text-rose-400 mx-auto mb-2" />
              <div className="text-xl font-bold text-slate-200">{apiMs !== null ? `${apiMs}ms` : '—'}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">API Latency</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
