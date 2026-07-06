import { useState, useRef, useEffect, useCallback } from 'react';
import { PhoneCall, Phone, Mic, MicOff, Activity, Settings, PhoneOff } from 'lucide-react';

interface CallStats {
  codec: string;
  rttMs: number | null;
  bytesSent: number;
  bytesReceived: number;
  packetsLost: number;
  candidateType: string;
}

export function VoipNode() {
  // Real WebRTC: microphone capture + a genuine RTCPeerConnection loopback call
  // (two local peers negotiating SDP/ICE), with live stats from pc.getStats()
  const [callActive, setCallActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const pc1Ref = useRef<RTCPeerConnection | null>(null);
  const pc2Ref = useRef<RTCPeerConnection | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (statsTimerRef.current) clearInterval(statsTimerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    pc1Ref.current?.close();
    pc2Ref.current?.close();
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    pc1Ref.current = null;
    pc2Ref.current = null;
    audioCtxRef.current = null;
    setCallActive(false);
    setLevel(0);
    setStats(null);
  }, []);

  useEffect(() => teardown, [teardown]);

  const startCall = useCallback(async () => {
    setError(null);
    try {
      // 1. Real microphone capture
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      streamRef.current = stream;

      // 2. Live VU meter from an AnalyserNode
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const meter = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
        setLevel(Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 300)));
        rafRef.current = requestAnimationFrame(meter);
      };
      meter();

      // 3. Genuine SDP/ICE negotiation between two local peers
      const config: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
      const pc1 = new RTCPeerConnection(config);
      const pc2 = new RTCPeerConnection(config);
      pc1Ref.current = pc1;
      pc2Ref.current = pc2;
      pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate);
      pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate);
      pc2.ontrack = e => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.muted = true; // avoid feedback loop
        }
      };
      stream.getTracks().forEach(t => pc1.addTrack(t, stream));
      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      // 4. Real stats loop
      statsTimerRef.current = setInterval(async () => {
        if (!pc1Ref.current) return;
        const report = await pc1Ref.current.getStats();
        let codec = '—', rttMs: number | null = null, bytesSent = 0, bytesReceived = 0, packetsLost = 0, candidateType = '—';
        report.forEach(s => {
          if (s.type === 'codec' && s.mimeType?.includes('audio')) codec = s.mimeType.replace('audio/', '') + ` @ ${s.clockRate}Hz`;
          if (s.type === 'candidate-pair' && s.state === 'succeeded') {
            if (typeof s.currentRoundTripTime === 'number') rttMs = Math.round(s.currentRoundTripTime * 1000 * 10) / 10;
          }
          if (s.type === 'outbound-rtp') bytesSent = s.bytesSent ?? 0;
          if (s.type === 'inbound-rtp') { bytesReceived = s.bytesReceived ?? 0; packetsLost = s.packetsLost ?? 0; }
          if (s.type === 'local-candidate' && s.candidateType) candidateType = s.candidateType;
        });
        setStats({ codec, rttMs, bytesSent, bytesReceived, packetsLost, candidateType });
      }, 1000);

      setCallActive(true);
    } catch (e: any) {
      setError(`${e.name}: ${e.message}`);
      teardown();
    }
  }, [teardown]);

  const toggleMute = () => {
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = muted; });
    setMuted(m => !m);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
          <PhoneCall className="text-indigo-400" /> WebRTC VoIP Node
        </h2>
        <span className={`text-xs font-mono px-3 py-1 rounded-full border ${
          callActive ? 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' : 'text-slate-400 bg-slate-400/10 border-slate-500/20'
        }`}>
          {callActive ? 'LOOPBACK CALL LIVE' : 'IDLE'}
        </span>
      </div>

      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center min-h-[400px]">
          <div className="w-24 h-24 rounded-full bg-slate-800 border-4 border-slate-700 flex items-center justify-center mb-6 relative">
            <Phone className={`w-10 h-10 ${callActive ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className={`absolute bottom-0 right-0 w-6 h-6 border-2 border-slate-900 rounded-full ${callActive ? 'bg-emerald-500' : 'bg-slate-600'}`} />
          </div>
          <h3 className="text-xl font-bold text-slate-200 mb-2">
            {callActive ? 'Encrypted P2P Call Active' : 'Secure P2P Connection Ready'}
          </h3>
          <p className="text-slate-500 text-sm mb-6 max-w-md text-center">
            {callActive
              ? 'Your microphone is streaming over a real DTLS-SRTP encrypted RTCPeerConnection (local loopback — remote side muted to prevent feedback).'
              : 'Starting a call captures your real microphone and negotiates a genuine WebRTC session with live SDP, ICE, and RTP statistics.'}
          </p>

          {/* Live mic level */}
          <div className="w-full max-w-sm mb-8">
            <div className="flex justify-between text-[10px] font-mono text-slate-500 mb-1">
              <span>MIC LEVEL</span><span>{level}%</span>
            </div>
            <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-75 ${level > 70 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                style={{ width: `${level}%` }}
              />
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={toggleMute}
              disabled={!callActive}
              className={`w-14 h-14 rounded-full border flex items-center justify-center transition-colors disabled:opacity-40 ${
                muted ? 'bg-rose-500/20 text-rose-400 border-rose-500/50' : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50 hover:bg-indigo-500/30'
              }`}
            >
              {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </button>
            {callActive ? (
              <button onClick={teardown} className="px-8 h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors flex items-center gap-2">
                <PhoneOff className="w-5 h-5" /> End Call
              </button>
            ) : (
              <button onClick={startCall} className="px-8 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors">
                Start Call
              </button>
            )}
          </div>
          {error && <p className="mt-4 text-xs font-mono text-rose-400">{error}</p>}
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Live Telemetry (getStats)
            </h3>
            <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Codec</span>
                <span className="text-slate-300">{stats?.codec ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">RTT</span>
                <span className="text-slate-300">{stats?.rttMs !== null && stats ? `${stats.rttMs}ms` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Bytes Sent</span>
                <span className="text-emerald-400">{stats ? (stats.bytesSent / 1024).toFixed(1) + ' KB' : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Bytes Received</span>
                <span className="text-emerald-400">{stats ? (stats.bytesReceived / 1024).toFixed(1) + ' KB' : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Packets Lost</span>
                <span className="text-slate-300">{stats?.packetsLost ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">ICE Candidate</span>
                <span className="text-slate-300">{stats?.candidateType ?? '—'}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Configuration
            </h3>
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1">STUN Server</label>
              <input
                type="text"
                value="stun:stun.l.google.com:19302"
                readOnly
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-300 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
