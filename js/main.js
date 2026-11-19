// 進入點：開始／停止翻譯

import { GoogleGenAI } from 'https://esm.sh/@google/genai@2.32.0';
import { S, $, setStatus, showError, hideError } from './state.js?v=10';
import { BACKUP_MODEL_PREFIX } from './config.js?v=10';
import './glossary-ai.js?v=10';
import { initSettings } from './settings.js?v=10';
import { clearAllHistory, initCaptionPrefs, loadUnsavedTranscript, logPendingCaption } from './captions.js?v=10';
import { startTimer, stopTimer, requestWakeLock, releaseWakeLock } from './session.js?v=10';
import { connectSession, hotswapReconnect } from './connection.js?v=10';
import { stopMic } from './mic.js?v=10';

function showDownloadBtn(label) {
  $('downloadBtn').style.display = 'block';
  $('downloadBtn').textContent = `⬇ ${label}（${S.transcriptLog.length} 段）`;
}

window.onload = () => {
  initSettings();
  initCaptionPrefs();
  // 上次翻譯途中當機／誤關網頁：把沒下載的逐字稿救回來
  const prev = loadUnsavedTranscript();
  if (prev) {
    S.transcriptLog  = prev.entries;
    S.transcriptDate = prev.date;
    showDownloadBtn(`下載上次逐字稿 ${prev.date}`);
  }
};

window.startTranslation = async function() {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) { setStatus('請先填入 Gemini API Key', 'error'); return; }

  const prev = loadUnsavedTranscript();
  if (prev && confirm(`上次的逐字稿（${prev.entries.length} 段）還沒下載，開始後會被新的取代。\n要先下載嗎？`)) {
    S.transcriptLog  = prev.entries;
    S.transcriptDate = prev.date;
    window.downloadTranscript();
  }

  const sourceLang  = $('sourceLang').value;
  const targetLang  = $('targetLang').value;
  const sysPromptTx = $('sysPrompt').value.trim();
  S.costLimitTwd      = Number($('costLimit').value || 0);
  S.captionHoldMs     = Number($('captionHold').value || 12) * 1000;
  S.hotswapIntervalMs = Number($('hotswapInterval').value || 0) * 1000;
  S.modelKey          = $('modelChoice').value;

  $('startBtn').style.display    = 'none';
  $('stopBtn').style.display     = 'block';
  $('downloadBtn').style.display = 'none';
  $('artistPreset').disabled     = true;
  $('captions').style.display    = 'block';
  document.body.classList.add('live');   // 收起設定，字幕佔滿畫面
  setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
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
  S.tokBaseIn = S.tokBaseOut = S.connInTok = S.connOutTok = 0;
  S.currentCostTwd    = 0;
  S.autoStoppedByCost = false;
  S.audioChunkCount   = 0;
  S.silentChunkCount  = 0;
  S.lastAudioLevel    = 0;
  S.lastInputAt       = 0;
  S.lastOutputAt      = 0;
  S.transcriptLog     = [];
  S.transcriptDate    = new Date().toLocaleDateString('zh-TW');
  S.setupOk          = false;
  S.everConnected     = false;
  S.extendedOff       = false;
  S.resumeHandle      = null;
  S.reconnectAttempts = 0;
  S.lastErrorMsg      = '';
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
    };
    let prompt = sysPromptTx;
    if (S.modelKey === 'live') {
      prompt = BACKUP_MODEL_PREFIX(targetLang) + sysPromptTx;   // 備援模型沒有翻譯專用設定
    } else {
      S.currentConfig.translationConfig = { targetLanguageCode: targetLang, echoTargetLanguage: false };
    }
    if (prompt) S.currentConfig.systemInstruction = { parts: [{ text: prompt }] };

    const session = await connectSession(false);
    if (session) S.liveSession = session;
  } catch (err) {
    if (!S.running) return;
    showError('連線失敗：' + err.message);
    setStatus('連線失敗', 'error');
    window.stopTranslation();
  }
};

window.stopTranslation = function() {
  if (S.running) logPendingCaption();   // 最後一句還在畫面上、沒收進逐字稿
  S.running = false;
  S.connId++;                           // 還在路上的連線全部作廢，晚到也會被關掉
  document.body.classList.remove('live');
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

  if (S.transcriptLog.length > 0) showDownloadBtn('下載逐字稿');

  if (!$('status').className.includes('error')) setStatus('已停止');
};
