// 麥克風：收音 → 轉成 16kHz PCM → 送給 Gemini

import { S, $ } from './state.js';

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

export function stopMic() {
  if (S.processor)    { try { S.processor.disconnect(); } catch(_){} S.processor = null; }
  if (S.audioContext) { try { S.audioContext.close(); }   catch(_){} S.audioContext = null; }
  if (S.micStream)    { S.micStream.getTracks().forEach(t => t.stop()); S.micStream = null; }
}
