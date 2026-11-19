// Gemini Live 連線：建立連線、收訊息、費用計算、狀態燈號、熱切換重連

import { S, $, setStatus, showError } from './state.js';
import { RATE_INPUT_PER_M, RATE_OUTPUT_PER_M, RATE_AUDIO_PER_MIN_USD, USD_TWD, LIVE_MODEL } from './config.js';
import { isPunctEnd, scheduleSegmentFlush, flushSegment, updateImmediateCaption } from './captions.js';
import { startMic } from './mic.js';

// ── 狀態燈號 ──────────────────────────────────────────────────────────────
function updateStatusLights() {
  if (!S.running) return;
  const micOk  = S.lastAudioLevel > 0.003;
  const micTxt = micOk ? '🎤 有聲音' : '🔇 麥克風太安靜';

  let transTxt, isWarn = false;
  if (!S.lastOutputAt) {
    transTxt = '📡 等待翻譯…';
  } else {
    const secs = Math.round((Date.now() - S.lastOutputAt) / 1000);
    if (secs > 10) { transTxt = `⚠️ 超過 ${secs} 秒沒有翻譯`; isWarn = true; }
    else           { transTxt = `📨 翻譯 ${secs} 秒前`; }
  }

  $('statusLights').innerHTML =
    `${micTxt}&nbsp;&nbsp;｜&nbsp;&nbsp;<span${isWarn ? ' class="warn"' : ''}>${transTxt}</span>`;
}

// ── Cost display ──────────────────────────────────────────────────────────
export function startTimer() { S.timerInterval = setInterval(refreshCost, 1000); }
export function stopTimer()  { clearInterval(S.timerInterval); S.timerInterval = null; }

function refreshCost() {
  const secs = Math.floor((Date.now() - S.sessionStart) / 1000);
  const mm   = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss   = String(secs % 60).padStart(2, '0');

  let costStr;
  if (S.totalInputTok + S.totalOutputTok > 0) {
    const usd = (S.totalInputTok / 1e6) * RATE_INPUT_PER_M + (S.totalOutputTok / 1e6) * RATE_OUTPUT_PER_M;
    S.currentCostTwd = usd * USD_TWD;
    costStr = `${mm}:${ss} ｜ ${(S.totalInputTok + S.totalOutputTok).toLocaleString()} tokens ≈ NT$${S.currentCostTwd.toFixed(4)}`;
  } else {
    S.currentCostTwd = secs / 60 * RATE_AUDIO_PER_MIN_USD * USD_TWD;
    costStr = `${mm}:${ss} ｜ 付費估算 ≈ NT$${S.currentCostTwd.toFixed(4)}`;
  }
  $('costDisplay').textContent = costStr;
  updateStatusLights();
  enforceCostLimit();
}

function enforceCostLimit() {
  if (!S.running || S.autoStoppedByCost || S.costLimitTwd <= 0) return;
  if (S.currentCostTwd < S.costLimitTwd) return;
  S.autoStoppedByCost = true;
  showError(`已達費用上限 NT$${S.costLimitTwd}，已自動停止。實際費用仍以 Google AI Studio 帳單為準。`);
  setStatus('費用上限停止', 'error');
  window.stopTranslation();
}

// ── Wake Lock ─────────────────────────────────────────────────────────────
export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { S.wakeLock = await navigator.wakeLock.request('screen'); }
  catch (_) {}
}
export async function releaseWakeLock() {
  if (!S.wakeLock) return;
  try { await S.wakeLock.release(); } catch (_) {}
  S.wakeLock = null;
}

// 回到前景時重新申請 Wake Lock
document.addEventListener('visibilitychange', async () => {
  if (S.running && document.visibilityState === 'visible' && !S.wakeLock) {
    await requestWakeLock();
  }
});

// ── Session callbacks ─────────────────────────────────────────────────────
function handleMessage(message) {
  const u = message.usageMetadata;
  if (u) {
    if (u.promptTokenCount != null)     S.totalInputTok  = u.promptTokenCount;
    if (u.candidatesTokenCount != null) S.totalOutputTok = u.candidatesTokenCount;
    if (u.totalTokenCount != null && u.promptTokenCount == null) {
      S.totalInputTok  = Math.round(u.totalTokenCount * 0.85);
      S.totalOutputTok = Math.round(u.totalTokenCount * 0.15);
    }
    refreshCost();
  }

  const content = message.serverContent;
  if (!content) return;

  if ($('aiSegment').checked) {
    let contentChanged = false;
    const inputText  = content.inputTranscription?.text;
    const outputText = content.outputTranscription?.text;
    if (inputText  && inputText  !== S.origBuffer)  { S.origBuffer  = inputText;  S.lastInputAt  = Date.now(); contentChanged = true; }
    if (outputText && outputText !== S.transBuffer) { S.transBuffer = outputText; S.lastOutputAt = Date.now(); contentChanged = true; }

    if (contentChanged) {
      if (S.origBuffer)  { const el = $('originalText');   el.textContent = S.origBuffer;  el.classList.add('partial'); }
      if (S.transBuffer) { const el = $('translatedText'); el.textContent = S.transBuffer; el.classList.add('partial'); }
      scheduleSegmentFlush(isPunctEnd(S.transBuffer) || isPunctEnd(S.origBuffer));
    }
    if (content.turnComplete) { clearTimeout(S.segFlushTimer); S.segFlushTimer = null; flushSegment(); }
  } else {
    if (content.inputTranscription?.text)  { S.lastInputAt  = Date.now(); updateImmediateCaption('original',   content.inputTranscription.text); }
    if (content.outputTranscription?.text) { S.lastOutputAt = Date.now(); updateImmediateCaption('translated', content.outputTranscription.text); }
  }
}

function handleError(e) {
  if (S.isHotswapping) return;
  showError('連線錯誤：' + (e?.message || JSON.stringify(e)));
  setStatus('連線錯誤', 'error');
  window.stopTranslation();
}

function handleClose(e) {
  if (S.isHotswapping) return; // 熱切換主動關閉，忽略
  if (S.running) {
    const reason = e?.reason || '';
    showError('連線中斷' + (reason ? `：${reason}` : '（原因不明）'));
    setStatus('連線中斷', 'error');
    window.stopTranslation();
  }
}

// ── Connect session（初次 + 熱切換共用）────────────────────────────────────
export async function connectSession(isReconnect) {
  return S.currentAi.live.connect({
    model: LIVE_MODEL,
    config: S.currentConfig,
    callbacks: {
      onopen: async () => {
        if (isReconnect) {
          S.isHotswapping = false;
          setStatus('● 翻譯中', 'active');
        } else {
          setStatus('● 翻譯中', 'active');
          try { await startMic(); }
          catch (err) {
            showError('麥克風錯誤：' + err.message);
            setStatus('麥克風失敗', 'error');
            window.stopTranslation();
          }
        }
      },
      onmessage: handleMessage,
      onerror:   handleError,
      onclose:   handleClose
    }
  });
}

// ── 熱切換重連 ────────────────────────────────────────────────────────────
export async function hotswapReconnect() {
  if (!S.running || !S.currentAi) return;
  S.isHotswapping = true;
  setStatus('重連中…', '');

  const oldSession = S.liveSession;
  S.liveSession = null; // 讓 mic processor 暫停發送
  try { oldSession?.close(); } catch(_) {}

  await new Promise(r => setTimeout(r, 300));

  try {
    S.liveSession = await connectSession(true);
  } catch (err) {
    S.isHotswapping = false;
    showError('重連失敗：' + err.message);
    setStatus('重連失敗', 'error');
    window.stopTranslation();
  }
}
