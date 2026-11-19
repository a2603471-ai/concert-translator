// 麥克風：收音 → 轉成 16kHz PCM → 送給 Gemini

import { S, $, showError } from './state.js?v=10';

function nextPow2(n) { return Math.pow(2, Math.round(Math.log2(n))); }

export async function startMic() {
  const useNoiseSuppression = $('noiseSuppression').value === 'true';
  S.micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: useNoiseSuppression }
  });
  S.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (S.audioContext.state === 'suspended') await S.audioContext.resume();

  const nativeRate = S.audioContext.sampleRate;
  const source     = S.audioContext.createMediaStreamSource(S.micStream);
  const bufferSize = nextPow2(Math.round(nativeRate * 0.06));
  S.processor      = S.audioContext.createScriptProcessor(bufferSize, 1, 1);

  S.processor.onaudioprocess = (e) => {
    if (!S.liveSession || !S.running) return;
    const f32 = e.inputBuffer.getChannelData(0);
    S.audioChunkCount++;

    let samples = f32;
    if (nativeRate !== 16000) {
      const ratio  = nativeRate / 16000;
      const newLen = Math.round(f32.length / ratio);
      samples = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++)
        samples[i] = f32[Math.min(Math.round(i * ratio), f32.length - 1)];
    }

    const i16 = new Int16Array(samples.length);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      peak = Math.max(peak, Math.abs(s));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    S.lastAudioLevel = peak;
    if (peak < 0.003) S.silentChunkCount++;

    const bytes = new Uint8Array(i16.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    try { S.liveSession.sendRealtimeInput({ audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } }); }
    catch (_) {}
  };

  source.connect(S.processor);
  S.processor.connect(S.audioContext.destination);
}

// iPhone 鎖屏、切 App、來電後，系統會暫停錄音或結束麥克風音軌；
// 連線接回時呼叫這裡，暫停的叫醒、結束的重開，避免「畫面顯示翻譯中但其實沒收音」
export async function ensureMic() {
  if (!S.running || !S.micStream) return;
  const ended = S.micStream.getTracks?.().some(t => t.readyState === 'ended');
  try {
    if (ended) { stopMic(); await startMic(); return; }
    if (S.audioContext && S.audioContext.state !== 'running') await S.audioContext.resume();
  } catch (err) {
    showError('麥克風恢復失敗，請按停止再重新開始：' + err.message);
  }
}

export function stopMic() {
  if (S.processor)    { try { S.processor.disconnect(); } catch(_){} S.processor = null; }
  if (S.audioContext) { try { S.audioContext.close(); }   catch(_){} S.audioContext = null; }
  if (S.micStream)    { S.micStream.getTracks().forEach(t => t.stop()); S.micStream = null; }
}
