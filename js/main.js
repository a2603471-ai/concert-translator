// 進入點：開始／停止翻譯

import { GoogleGenAI } from 'https://esm.sh/@google/genai@2.32.0';
import { S, $, setStatus, showError, hideError } from './state.js';
import { initSettings } from './settings.js';
import { clearAllHistory } from './captions.js';
import { startTimer, stopTimer, requestWakeLock, releaseWakeLock, connectSession, hotswapReconnect } from './session.js';
import { stopMic } from './mic.js';

window.onload = initSettings;

window.startTranslation = async function() {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) { setStatus('請先填入 Gemini API Key', 'error'); return; }

  const sourceLang  = $('sourceLang').value;
  const targetLang  = $('targetLang').value;
  const sysPromptTx = $('sysPrompt').value.trim();
  S.costLimitTwd      = Number($('costLimit').value || 0);
  S.captionHoldMs     = Number($('captionHold').value || 12) * 1000;
  S.hotswapIntervalMs = Number($('hotswapInterval').value || 0) * 1000;

  $('startBtn').style.display    = 'none';
  $('stopBtn').style.display     = 'block';
  $('downloadBtn').style.display = 'none';
  $('artistPreset').disabled     = true;
  $('captions').style.display    = 'block';
  setTimeout(() => $('captions').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  $('costLine').style.display     = 'block';
  $('statusLights').style.display = 'block';
  $('originalText').textContent   = '—';
  $('translatedText').textContent = '—';
  $('translatedText').classList.remove('partial');
  $('originalText').classList.remove('partial');
  clearAllHistory();
  hideError();
  setStatus('連線中…');

  S.running           = true;
  S.origBuffer        = '';
  S.transBuffer       = '';
  clearTimeout(S.segFlushTimer); S.segFlushTimer = null;
  S.lastImmediateOriginal   = '';
  S.lastImmediateTranslated = '';
  S.totalInputTok     = 0;
  S.totalOutputTok    = 0;
  S.currentCostTwd    = 0;
  S.autoStoppedByCost = false;
  S.audioChunkCount   = 0;
  S.silentChunkCount  = 0;
  S.lastAudioLevel    = 0;
  S.lastInputAt       = 0;
  S.lastOutputAt      = 0;
  S.transcriptLog     = [];
  S.sessionStart      = Date.now();
  startTimer();
  await requestWakeLock();

  if (S.hotswapIntervalMs > 0) S.hotswapTimer = setInterval(hotswapReconnect, S.hotswapIntervalMs);

  try {
    S.currentAi = new GoogleGenAI({ apiKey });
    S.currentConfig = {
      responseModalities: ['AUDIO'],
      inputAudioTranscription: sourceLang === 'auto' ? {} : { languageCode: sourceLang },
      outputAudioTranscription: {},
      translationConfig: { targetLanguageCode: targetLang, echoTargetLanguage: false }
    };
    if (sysPromptTx) S.currentConfig.systemInstruction = { parts: [{ text: sysPromptTx }] };

    S.liveSession = await connectSession(false);
  } catch (err) {
    showError('連線失敗：' + err.message);
    setStatus('連線失敗', 'error');
    window.stopTranslation();
  }
};

window.stopTranslation = function() {
  S.running = false;
  stopTimer();
  clearTimeout(S.segFlushTimer); S.segFlushTimer = null;
  clearInterval(S.hotswapTimer); S.hotswapTimer = null;
  clearAllHistory();
  releaseWakeLock();
  $('statusLights').style.display = 'none';
  stopMic();
  if (S.liveSession) { try { S.liveSession.close(); } catch(_){} S.liveSession = null; }

  $('startBtn').style.display = 'block';
  $('stopBtn').style.display  = 'none';
  $('artistPreset').disabled  = false;

  if (S.transcriptLog.length > 0) {
    $('downloadBtn').style.display = 'block';
    $('downloadBtn').textContent = `⬇ 下載逐字稿（${S.transcriptLog.length} 段）`;
  }

  if (!$('status').className.includes('error')) setStatus('已停止');
};
