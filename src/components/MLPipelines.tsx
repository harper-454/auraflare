import { useState, useRef, useCallback, useEffect } from 'react';
import { BrainCircuit, Play, Square, RotateCcw } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

// A real neural network trained in your browser: 1-16-1 MLP with tanh,
// full-batch gradient descent, learning y = sin(2πx).
const SAMPLES = 64;

interface Net {
  w1: number[]; b1: number[];
  w2: number[]; b2: number;
  hidden: number;
}

function makeNet(hidden: number): Net {
  const rand = () => (Math.random() - 0.5) * 2;
  return {
    hidden,
    w1: Array.from({ length: hidden }, rand),
    b1: Array.from({ length: hidden }, rand),
    w2: Array.from({ length: hidden }, rand),
    b2: 0,
  };
}

function forward(net: Net, x: number): { y: number; h: number[] } {
  const h = net.w1.map((w, j) => Math.tanh(w * x + net.b1[j]));
  const y = h.reduce((s, hj, j) => s + net.w2[j] * hj, net.b2);
  return { y, h };
}

// One full-batch gradient descent step; returns MSE loss (real math, no fakery)
function trainStep(net: Net, xs: number[], ys: number[], lr: number): number {
  const gw1 = new Array(net.hidden).fill(0);
  const gb1 = new Array(net.hidden).fill(0);
  const gw2 = new Array(net.hidden).fill(0);
  let gb2 = 0, loss = 0;

  for (let i = 0; i < xs.length; i++) {
    const { y, h } = forward(net, xs[i]);
    const err = y - ys[i];
    loss += err * err;
    gb2 += err;
    for (let j = 0; j < net.hidden; j++) {
      gw2[j] += err * h[j];
      const dh = err * net.w2[j] * (1 - h[j] * h[j]);
      gw1[j] += dh * xs[i];
      gb1[j] += dh;
    }
  }
  const n = xs.length;
  for (let j = 0; j < net.hidden; j++) {
    net.w1[j] -= lr * gw1[j] / n;
    net.b1[j] -= lr * gb1[j] / n;
    net.w2[j] -= lr * gw2[j] / n;
  }
  net.b2 -= lr * gb2 / n;
  return loss / n;
}

export function MLPipelines() {
  const [training, setTraining] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [lossHistory, setLossHistory] = useState<{ epoch: number; loss: number }[]>([]);
  const [fitData, setFitData] = useState<{ x: number; target: number; prediction: number }[]>([]);
  const [lr, setLr] = useState(0.1);
  const [hidden, setHidden] = useState(16);

  const netRef = useRef<Net>(makeNet(16));
  const dataRef = useRef<{ xs: number[]; ys: number[] }>({ xs: [], ys: [] });
  const rafRef = useRef(0);

  const initData = useCallback(() => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = (i / (SAMPLES - 1)) * 2 - 1;
      xs.push(x);
      ys.push(Math.sin(Math.PI * 2 * x) * 0.8);
    }
    dataRef.current = { xs, ys };
  }, []);

  const snapshotFit = useCallback(() => {
    const { xs, ys } = dataRef.current;
    setFitData(xs.map((x, i) => ({
      x: Number(x.toFixed(2)),
      target: Number(ys[i].toFixed(3)),
      prediction: Number(forward(netRef.current, x).y.toFixed(3)),
    })));
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setTraining(false);
    netRef.current = makeNet(hidden);
    initData();
    setEpoch(0);
    setLossHistory([]);
    snapshotFit();
  }, [hidden, initData, snapshotFit]);

  useEffect(() => { reset(); }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const start = useCallback(() => {
    setTraining(true);
    let e = epoch;
    const loop = () => {
      // 20 real gradient steps per frame
      let loss = 0;
      for (let k = 0; k < 20; k++) {
        loss = trainStep(netRef.current, dataRef.current.xs, dataRef.current.ys, lr);
        e++;
      }
      setEpoch(e);
      setLossHistory(h => [...h.slice(-149), { epoch: e, loss: Number(loss.toFixed(5)) }]);
      snapshotFit();
      if (e < 20000 && loss > 1e-5) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        setTraining(false);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [epoch, lr, snapshotFit]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setTraining(false);
  }, []);

  const currentLoss = lossHistory.length ? lossHistory[lossHistory.length - 1].loss : null;
  const tooltipStyle = { backgroundColor: '#10131a', border: '1px solid #242a35', borderRadius: 8, color: '#e2e6ee', fontSize: 12 };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <BrainCircuit className="text-indigo-400" /> ML Training Pipeline
        </h2>
        <span className="text-xs font-mono text-indigo-400 bg-indigo-400/10 px-3 py-1 rounded-full border border-indigo-500/20">
          LIVE TRAINING · IN-BROWSER
        </span>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-bold text-slate-200">MLP Regression: learn sin(2πx)</h3>
            <p className="text-sm text-slate-400 mt-1">
              1-{hidden}-1 network, tanh activation, full-batch gradient descent — every weight update is real math running in this tab.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={training ? stop : start}
              className={`px-4 py-2 rounded flex items-center gap-2 text-sm font-bold transition-colors ${
                training
                  ? 'bg-rose-600/20 text-rose-400 border border-rose-500/50 hover:bg-rose-600/30'
                  : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-600/30'
              }`}
            >
              {training ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {training ? 'Pause' : 'Train'}
            </button>
            <button onClick={reset} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded flex items-center gap-2 text-sm transition-colors">
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">Epoch</div>
            <div className="text-xl font-bold font-mono text-slate-100">{epoch.toLocaleString()}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">MSE Loss</div>
            <div className="text-xl font-bold font-mono text-emerald-400">{currentLoss ?? '—'}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-500 mb-1">Parameters</div>
            <div className="text-xl font-bold font-mono text-slate-100">{hidden * 3 + 1}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-slate-300 mb-3">Loss Curve</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={lossHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#242a35" />
                <XAxis dataKey="epoch" stroke="#5c6675" fontSize={10} />
                <YAxis stroke="#5c6675" fontSize={10} domain={[0, 'auto']} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="loss" stroke="#e58398" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-300 mb-3">Model Fit vs Target</h4>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={fitData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#242a35" />
                <XAxis dataKey="x" stroke="#5c6675" fontSize={10} />
                <YAxis stroke="#5c6675" fontSize={10} domain={[-1.2, 1.2]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="target" stroke="#5c6675" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="prediction" stroke="#7b8cfa" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-wrap gap-6 mt-6 pt-6 border-t border-slate-800">
          <div className="flex-1 min-w-48">
            <label className="text-xs font-bold text-slate-500 block mb-2">Learning Rate: {lr}</label>
            <input type="range" min={0.01} max={0.5} step={0.01} value={lr} onChange={e => setLr(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-xs font-bold text-slate-500 block mb-2">Hidden Units: {hidden} (resets model)</label>
            <input type="range" min={4} max={32} step={4} value={hidden} onChange={e => setHidden(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
