import { useState, useMemo, useCallback } from 'react';
import { Atom, Activity, BarChart2, RotateCcw } from 'lucide-react';

const NUM_QUBITS = 3;
const DIM = 1 << NUM_QUBITS;

type GateName = 'H' | 'X' | 'Z' | 'CNOT';

interface GateOp {
  gate: GateName;
  target: number;
  control?: number;
}

interface State { re: Float64Array; im: Float64Array }

// ——— A real statevector simulator ———
function initialState(): State {
  const re = new Float64Array(DIM); re[0] = 1;
  return { re, im: new Float64Array(DIM) };
}

function applyGate(s: State, op: GateOp): State {
  const re = Float64Array.from(s.re);
  const im = Float64Array.from(s.im);
  const t = 1 << op.target;
  const r = Math.SQRT1_2;
  for (let i = 0; i < DIM; i++) {
    if (i & t) continue; // handle each pair once, from the |0⟩ side
    const j = i | t;
    switch (op.gate) {
      case 'H': {
        const ar = re[i], ai = im[i], br = re[j], bi = im[j];
        re[i] = r * (ar + br); im[i] = r * (ai + bi);
        re[j] = r * (ar - br); im[j] = r * (ai - bi);
        break;
      }
      case 'X': {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
        break;
      }
      case 'Z': {
        re[j] = -re[j]; im[j] = -im[j];
        break;
      }
      case 'CNOT': {
        const c = 1 << (op.control ?? 0);
        // swap |...c=1,t=0⟩ ↔ |...c=1,t=1⟩
        if ((i & c) === c) {
          [re[i], re[j]] = [re[j], re[i]];
          [im[i], im[j]] = [im[j], im[i]];
        }
        break;
      }
    }
  }
  return { re, im };
}

function runCircuit(ops: GateOp[]): State {
  return ops.reduce(applyGate, initialState());
}

export function QuantumEmulator() {
  // Default circuit: Bell pair on q0,q1 (H then CNOT) — same state the old mock displayed, now actually computed
  const [ops, setOps] = useState<GateOp[]>([
    { gate: 'H', target: 0 },
    { gate: 'CNOT', control: 0, target: 1 },
  ]);
  const [selectedGate, setSelectedGate] = useState<GateName>('H');
  const [shots, setShots] = useState<Record<string, number> | null>(null);

  const state = useMemo(() => runCircuit(ops), [ops]);

  const amplitudes = useMemo(() => {
    const out: { basis: string; amp: string; prob: number }[] = [];
    for (let i = 0; i < DIM; i++) {
      const prob = state.re[i] ** 2 + state.im[i] ** 2;
      if (prob < 1e-9) continue;
      const basis = i.toString(2).padStart(NUM_QUBITS, '0');
      const rePart = state.re[i].toFixed(4);
      const imPart = state.im[i];
      const amp = Math.abs(imPart) < 1e-9 ? rePart : `${rePart}${imPart >= 0 ? '+' : ''}${imPart.toFixed(4)}i`;
      out.push({ basis, amp, prob });
    }
    return out;
  }, [state]);

  const addGate = useCallback((qubit: number) => {
    setShots(null);
    if (selectedGate === 'CNOT') {
      const target = (qubit + 1) % NUM_QUBITS;
      setOps(o => [...o, { gate: 'CNOT', control: qubit, target }]);
    } else {
      setOps(o => [...o, { gate: selectedGate, target: qubit }]);
    }
  }, [selectedGate]);

  const measure = useCallback(() => {
    // Sample 1024 real measurements from the computed distribution
    const probs = Array.from({ length: DIM }, (_, i) => state.re[i] ** 2 + state.im[i] ** 2);
    const counts: Record<string, number> = {};
    for (let s = 0; s < 1024; s++) {
      let x = Math.random(), k = 0;
      while (k < DIM - 1 && x > probs[k]) { x -= probs[k]; k++; }
      const key = k.toString(2).padStart(NUM_QUBITS, '0');
      counts[key] = (counts[key] ?? 0) + 1;
    }
    setShots(counts);
  }, [state]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Atom className="text-indigo-400" /> Quantum State Emulator
        </h2>
        <span className="text-xs font-mono text-indigo-400 bg-indigo-400/10 px-3 py-1 rounded-full border border-indigo-500/20">
          REAL STATEVECTOR · {NUM_QUBITS} QUBITS
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-200">Circuit Builder</h3>
            <button onClick={() => { setOps([]); setShots(null); }} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            {(['H', 'X', 'Z', 'CNOT'] as GateName[]).map(g => (
              <button
                key={g}
                onClick={() => setSelectedGate(g)}
                className={`px-3 py-1.5 rounded text-xs font-mono font-bold border transition-colors ${
                  selectedGate === g
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-indigo-500/50'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {Array.from({ length: NUM_QUBITS }, (_, q) => (
              <div key={q} className="flex items-center gap-3">
                <span className="font-mono text-xs text-slate-400 w-10">|q{q}⟩</span>
                <div className="flex-1 h-10 bg-slate-950 border border-slate-800 rounded flex items-center px-2 gap-1.5 overflow-x-auto">
                  {ops.map((op, i) => {
                    const isTarget = op.target === q;
                    const isControl = op.gate === 'CNOT' && op.control === q;
                    if (!isTarget && !isControl) return <span key={i} className="w-8 shrink-0 border-t border-slate-700" />;
                    return (
                      <span
                        key={i}
                        className={`w-8 h-7 shrink-0 rounded flex items-center justify-center text-[10px] font-mono font-bold border ${
                          isControl
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                            : 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                        }`}
                        title={op.gate === 'CNOT' ? `CNOT c=q${op.control} t=q${op.target}` : `${op.gate} on q${op.target}`}
                      >
                        {isControl ? '●' : op.gate === 'CNOT' ? '⊕' : op.gate}
                      </span>
                    );
                  })}
                </div>
                <button
                  onClick={() => addGate(q)}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300 transition-colors shrink-0"
                  title={selectedGate === 'CNOT' ? `Add CNOT: control q${q} → target q${(q + 1) % NUM_QUBITS}` : `Apply ${selectedGate} to q${q}`}
                >
                  + {selectedGate}
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={measure}
            className="w-full mt-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded transition-colors flex items-center justify-center gap-2"
          >
            <BarChart2 className="w-4 h-4" /> Measure (1024 shots)
          </button>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4" /> State Vector (computed)
            </h3>
            <div className="space-y-2 font-mono text-xs max-h-44 overflow-y-auto">
              {amplitudes.map(a => (
                <div key={a.basis} className="flex justify-between items-center p-2 bg-slate-950 rounded">
                  <span className="text-slate-400">|{a.basis}⟩</span>
                  <span className="text-indigo-400">{a.amp} ({(a.prob * 100).toFixed(1)}%)</span>
                </div>
              ))}
              {amplitudes.length === 0 && <span className="text-slate-600">vacuum</span>}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <BarChart2 className="w-4 h-4" /> Measurement Histogram
            </h3>
            {shots ? (
              <div className="space-y-2">
                {Object.entries(shots).sort().map(([basis, count]) => (
                  <div key={basis} className="flex items-center gap-3 font-mono text-xs">
                    <span className="text-slate-400 w-12">|{basis}⟩</span>
                    <div className="flex-1 h-3 bg-slate-950 rounded overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${(count / 1024) * 100}%` }} />
                    </div>
                    <span className="text-slate-300 w-10 text-right">{count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Run a measurement to sample real outcomes from the computed amplitudes. Try the default Bell circuit — you'll only ever see |000⟩ and |011⟩.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
