import { useState, useEffect } from 'react';
import { Cpu, Wifi, ActivitySquare, BatteryCharging, Monitor, Gamepad2 } from 'lucide-react';

interface BatteryInfo {
  level: number;
  charging: boolean;
}

interface NetInfo {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
}

export function IoTEdge() {
  // Real edge telemetry: this machine is the device. Battery, network,
  // display, and gamepad data come from live browser APIs.
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [net, setNet] = useState<NetInfo>({});
  const [online, setOnline] = useState(navigator.onLine);
  const [gamepads, setGamepads] = useState<string[]>([]);

  useEffect(() => {
    // Battery Status API (Chromium)
    (navigator as any).getBattery?.().then((b: any) => {
      const update = () => setBattery({ level: Math.round(b.level * 100), charging: b.charging });
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => {});

    // Network Information API
    const conn = (navigator as any).connection;
    const updateNet = () => conn && setNet({ effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt });
    updateNet();
    conn?.addEventListener('change', updateNet);

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);

    // Gamepad API — real connected controllers
    const pollPads = () => {
      const pads = [...navigator.getGamepads()].filter(Boolean).map(p => p!.id);
      setGamepads(pads);
    };
    pollPads();
    const padTimer = setInterval(pollPads, 2000);

    return () => {
      conn?.removeEventListener('change', updateNet);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(padTimer);
    };
  }, []);

  const deviceMemory = (navigator as any).deviceMemory as number | undefined;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <ActivitySquare className="text-indigo-400" /> Edge Device Telemetry
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          online ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' : 'text-rose-400 bg-rose-400/10 border-rose-500/20'
        }`}>
          {online ? 'DEVICE ONLINE' : 'OFFLINE'}
        </span>
      </div>

      <p className="text-sm text-slate-400">
        Live readings from this machine's hardware via browser device APIs — no simulated values.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <Cpu className="text-slate-400" />
            <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded border border-emerald-500/50">Online</span>
          </div>
          <div className="text-lg font-bold text-slate-200">Compute Node (this machine)</div>
          <div className="text-xs text-slate-500 font-mono mt-1">{navigator.platform} · {navigator.hardwareConcurrency} threads</div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between text-sm">
            <span className="text-slate-400">RAM: <span className="text-indigo-400">{deviceMemory ? `≥${deviceMemory} GB` : 'n/a'}</span></span>
            <span className="text-slate-400">Cores: <span className="text-indigo-400">{navigator.hardwareConcurrency}</span></span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <Wifi className="text-slate-400" />
            <span className={`px-2 py-1 text-xs rounded border ${
              (net.rtt ?? 0) > 100
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
            }`}>
              {net.effectiveType?.toUpperCase() ?? 'LINK'}
            </span>
          </div>
          <div className="text-lg font-bold text-slate-200">Network Uplink</div>
          <div className="text-xs text-slate-500 font-mono mt-1">Network Information API</div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between text-sm">
            <span className="text-slate-400">Downlink: <span className="text-indigo-400">{net.downlink != null ? `${net.downlink} Mbps` : 'n/a'}</span></span>
            <span className="text-slate-400">RTT: <span className="text-indigo-400">{net.rtt != null ? `${net.rtt}ms` : 'n/a'}</span></span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <BatteryCharging className="text-slate-400" />
            <span className={`px-2 py-1 text-xs rounded border ${
              battery?.charging
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                : 'bg-slate-500/20 text-slate-400 border-slate-500/50'
            }`}>
              {battery ? (battery.charging ? 'Charging' : 'Discharging') : 'No sensor'}
            </span>
          </div>
          <div className="text-lg font-bold text-slate-200">Power Cell</div>
          <div className="text-xs text-slate-500 font-mono mt-1">Battery Status API</div>
          <div className="mt-4 pt-4 border-t border-slate-800">
            {battery ? (
              <>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-slate-400">Charge</span>
                  <span className={battery.level < 20 ? 'text-rose-400' : 'text-emerald-400'}>{battery.level}%</span>
                </div>
                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                  <div className={`h-full ${battery.level < 20 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${battery.level}%` }} />
                </div>
              </>
            ) : (
              <span className="text-sm text-slate-500">Not exposed on this device/browser (desktop without battery, or Firefox/Safari).</span>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-start mb-4">
            <Monitor className="text-slate-400" />
            <span className="px-2 py-1 bg-indigo-500/20 text-indigo-400 text-xs rounded border border-indigo-500/50">
              {window.devicePixelRatio}× DPR
            </span>
          </div>
          <div className="text-lg font-bold text-slate-200">Display Panel</div>
          <div className="text-xs text-slate-500 font-mono mt-1">{screen.width}×{screen.height} @ {screen.colorDepth}-bit</div>
          <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-2 text-sm text-slate-400">
            <Gamepad2 className="w-4 h-4 text-slate-500" />
            {gamepads.length > 0
              ? <span className="truncate" title={gamepads.join(', ')}>{gamepads.length} controller(s): {gamepads[0]}</span>
              : 'No game controllers detected (connect one and press a button)'}
          </div>
        </div>
      </div>
    </div>
  );
}
