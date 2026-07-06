import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Play, Square, Settings2, Download, AudioWaveform, Volume2 } from 'lucide-react';

export function MediaStudio() {
  // Real audio: MediaRecorder mic capture with live waveform, playback, WebM export,
  // and real text-to-speech through your OS voices (speechSynthesis)
  const [recording, setRecording] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [clipSize, setClipSize] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceIdx, setVoiceIdx] = useState(0);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [script, setScript] = useState('Welcome to the Aura Engine podcast. This voice is synthesized live by your operating system.');
  const [speaking, setSpeaking] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Real system voices
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.onvoiceschanged = load;
    return () => { speechSynthesis.onvoiceschanged = null; speechSynthesis.cancel(); };
  }, []);

  const stopAll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => stopAll, [stopAll]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => e.data.size && chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        setClipUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
        setClipSize(blob.size);
      };
      recorder.start();

      // Live waveform from the actual mic signal
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const draw = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          const c = canvas.getContext('2d')!;
          const { width, height } = canvas;
          c.clearRect(0, 0, width, height);
          analyser.getByteTimeDomainData(buf);
          c.beginPath();
          c.strokeStyle = '#7b8cfa';
          c.lineWidth = 2;
          for (let i = 0; i < buf.length; i++) {
            const x = (i / buf.length) * width;
            const y = (buf[i] / 255) * height;
            i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
          }
          c.stroke();
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      draw();

      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(e => e + 0.1), 100);
      setRecording(true);
    } catch (e: any) {
      setError(`${e.name}: ${e.message}`);
    }
  }, []);

  const speak = useCallback(() => {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(script);
    if (voices[voiceIdx]) utter.voice = voices[voiceIdx];
    utter.rate = rate;
    utter.pitch = pitch;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(utter);
  }, [script, voices, voiceIdx, rate, pitch]);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <Mic className="text-indigo-400" /> Audio Studio
        </h2>
        <span className="text-xs font-mono text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-500/20">
          WEB AUDIO · MEDIARECORDER
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex gap-4">
              {!recording ? (
                <button
                  onClick={startRecording}
                  title="Record from your microphone"
                  className="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors"
                >
                  <div className="w-4 h-4 rounded-full bg-white" />
                </button>
              ) : (
                <button
                  onClick={stopAll}
                  className="w-12 h-12 rounded-full bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition-colors"
                >
                  <Square className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className={`font-mono text-2xl ${recording ? 'text-rose-400' : 'text-slate-300'}`}>
              {fmt(elapsed)}
            </div>
          </div>

          <div className="flex gap-4 items-center mb-4">
            <div className="w-32 shrink-0 bg-slate-950 border border-slate-800 rounded p-3 text-xs font-mono text-slate-400 flex flex-col gap-2">
              <span className="text-indigo-400 font-bold">Mic Track</span>
              <span className="flex items-center gap-2">
                <AudioWaveform className="w-3 h-3" /> {recording ? 'LIVE' : 'stopped'}
              </span>
            </div>
            <div className="flex-1 h-24 bg-slate-950 rounded border border-slate-800 overflow-hidden">
              <canvas ref={canvasRef} width={800} height={96} className="w-full h-full" />
            </div>
          </div>

          {clipUrl && (
            <div className="flex items-center gap-4 p-4 bg-slate-950 border border-slate-800 rounded-lg">
              <audio controls src={clipUrl} className="flex-1 h-9" />
              <span className="text-xs font-mono text-slate-500">{(clipSize / 1024).toFixed(1)} KB</span>
              <a
                href={clipUrl}
                download="aura-recording.webm"
                className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition-colors"
              >
                <Download className="w-4 h-4" /> Export
              </a>
            </div>
          )}
          {error && <p className="mt-3 text-xs font-mono text-rose-400">{error}</p>}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Settings2 className="w-4 h-4" /> Speech Synthesis
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-2">Voice ({voices.length} installed)</label>
              <select
                value={voiceIdx}
                onChange={e => setVoiceIdx(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-300 focus:outline-none"
              >
                {voices.map((v, i) => (
                  <option key={v.voiceURI + i} value={i}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-2">Rate: {rate.toFixed(1)}×</label>
              <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={e => setRate(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-2">Pitch: {pitch.toFixed(1)}</label>
              <input type="range" min={0.5} max={2} step={0.1} value={pitch} onChange={e => setPitch(Number(e.target.value))} className="w-full accent-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-2">Script</label>
              <textarea
                value={script}
                onChange={e => setScript(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </div>
          <button
            onClick={speaking ? () => { speechSynthesis.cancel(); setSpeaking(false); } : speak}
            className="w-full mt-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition-colors flex items-center justify-center gap-2"
          >
            {speaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {speaking ? 'Stop' : 'Speak (real TTS)'}
          </button>
        </div>
      </div>
    </div>
  );
}
