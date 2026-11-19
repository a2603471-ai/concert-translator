// 翻譯進行中：處理伺服器訊息、費用計算、狀態燈號、防螢幕熄滅
// （建立連線與斷線重連在 connection.js）

import { S, $, setStatus, showError } from './state.js?v=10';
import { MODELS, USD_TWD } from './config.js?v=10';
import { isPunctEnd, scheduleSegmentFlush, flushSegment, updateImmediateCaption } from './captions.js?v=10';
import { ensureMic } from './mic.js?v=10';

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

  const m = MODELS[S.modelKey] || MODELS.translate;
  let costStr;
  if (S.totalInputTok + S.totalOutputTok > 0) {
    const usd = (S.totalInputTok / 1e6) * m.inPerM + (S.totalOutputTok / 1e6) * m.outPerM;
    S.currentCostTwd = usd * USD_TWD;
    costStr = `${mm}:${ss} ｜ ${(S.totalInputTok + S.totalOutputTok).toLocaleString()} tokens ≈ NT$${S.currentCostTwd.toFixed(4)}`;
  } else {
    S.currentCostTwd = secs / 60 * m.perMinUsd * USD_TWD;
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

// 回到前景時：重新申請 Wake Lock，並檢查麥克風是否被 iPhone 暫停
document.addEventListener('visibilitychange', async () => {
  if (!S.running || document.visibilityState !== 'visible') return;
  if (!S.wakeLock) await requestWakeLock();
  ensureMic();
});

// ── Session callbacks ─────────────────────────────────────────────────────
// 費用：伺服器回報的是「這條連線」的累計 token；換線後會從 0 重算，
// 所以把舊連線的數字收進 tokBase*，總數 = 舊連線合計 + 目前這條
export function handleMessage(message) {
  const u = message.usageMetadata;
  if (u) {
    if (u.promptTokenCount != null)     S.connInTok  = u.promptTokenCount;
    if (u.candidatesTokenCount != null) S.connOutTok = u.candidatesTokenCount;
    if (u.totalTokenCount != null && u.promptTokenCount == null) {
      S.connInTok  = Math.round(u.totalTokenCount * 0.85);
      S.connOutTok = Math.round(u.totalTokenCount * 0.15);
    }
    S.totalInputTok  = S.tokBaseIn  + S.connInTok;
    S.totalOutputTok = S.tokBaseOut + S.connOutTok;
    refreshCost();
    if (!S.running) return;   // 剛好達到費用上限而停止，這則訊息不再處理
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
