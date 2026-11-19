// 字幕顯示：目前句、歷史佇列、分句收句、逐字稿紀錄與下載

import { S, $ } from './state.js?v=12';
import { STABLE_FLUSH_MS, PUNCT_FLUSH_MS, MAX_HIST_SIZE } from './config.js?v=12';

const nowTime = () =>
  new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ── 逐字稿（每記一段就暫存到瀏覽器，當機或誤關網頁也救得回來）────────────
const AUTOSAVE_KEY = 'transcript_autosave';

export function logTranscript(orig, trans) {
  S.transcriptLog.push({ time: nowTime(), orig, trans });
  saveTranscript(false);
}

function saveTranscript(downloaded) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      date: S.transcriptDate || new Date().toLocaleDateString('zh-TW'),
      downloaded,
      entries: S.transcriptLog,
    }));
  } catch (_) {}   // 容量滿或無痕模式：暫存失敗不影響翻譯
}

// 讀回上次「還沒下載」的逐字稿；沒有就回傳 null
export function loadUnsavedTranscript() {
  try {
    const d = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    return (d && !d.downloaded && d.entries?.length) ? d : null;
  } catch { return null; }
}

// 停止時把畫面上還沒收進逐字稿的最後一句補記
export function logPendingCaption() {
  if ($('aiSegment').checked) {
    clearTimeout(S.segFlushTimer); S.segFlushTimer = null;
    flushSegment();
  } else if (S.lastImmediateTranslated) {
    logTranscript(S.lastImmediateOriginal, S.lastImmediateTranslated);
    S.lastImmediateTranslated = '';
  }
}

// ── 字幕大小、隱藏原文 ────────────────────────────────────────────────────
const SCALE_MIN = 0.8, SCALE_MAX = 2.0;

function applyCapScale(v) {
  document.documentElement.style.setProperty('--cap-scale', v);
}
window.changeCapScale = function(dir) {
  const cur  = Number(localStorage.getItem('cap_scale') || 1);
  const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round((cur + dir * 0.1) * 10) / 10));
  localStorage.setItem('cap_scale', next);
  applyCapScale(next);
};
function applyHideOrig(hide) {
  $('captions').classList.toggle('hide-orig', hide);
  $('origToggleBtn').textContent = hide ? '顯示原文' : '隱藏原文';
}
window.toggleOriginal = function() {
  const hide = !$('captions').classList.contains('hide-orig');
  localStorage.setItem('hide_original', hide);
  applyHideOrig(hide);
};
export function initCaptionPrefs() {
  applyCapScale(Number(localStorage.getItem('cap_scale') || 1));
  applyHideOrig(localStorage.getItem('hide_original') === 'true');
}

// ── Segment flush ─────────────────────────────────────────────────────────
export function isPunctEnd(text) {
  return /[！？!?～~…]+\s*$/.test(text || '');
}

export function scheduleSegmentFlush(done) {
  clearTimeout(S.segFlushTimer);
  S.segFlushTimer = setTimeout(flushSegment, done ? PUNCT_FLUSH_MS : STABLE_FLUSH_MS);
}

export function flushSegment() {
  S.segFlushTimer = null;
  if (!S.origBuffer && !S.transBuffer) return;

  if (S.transBuffer) logTranscript(S.origBuffer, S.transBuffer);

  if (S.origBuffer)  setPreviousCaption('original',   S.origBuffer);
  if (S.transBuffer) setPreviousCaption('translated', S.transBuffer);
  S.origBuffer  = '';
  S.transBuffer = '';
  const origEl  = $('originalText');
  const transEl = $('translatedText');
  origEl.textContent  = '';
  transEl.textContent = '';
  origEl.classList.remove('partial');
  transEl.classList.remove('partial');
}

function normalizeCaption(text) {
  return (text || '').replace(/\s+/g, '').trim();
}

function shouldPromotePrevious(prev, next) {
  const oldText = normalizeCaption(prev);
  const newText = normalizeCaption(next);
  if (oldText.length < 2 || !newText || oldText === newText) return false;
  if (newText.includes(oldText) || oldText.includes(newText)) return false;
  let commonPrefix = 0;
  const max = Math.min(oldText.length, newText.length);
  while (commonPrefix < max && oldText[commonPrefix] === newText[commonPrefix]) commonPrefix++;
  return commonPrefix / Math.max(oldText.length, newText.length) < 0.45;
}

// ── History slot visibility ───────────────────────────────────────────────
export function updateHistSlotVisibility() {
  for (let i = 1; i <= MAX_HIST_SIZE; i++) {
    const show = i <= S.histSize;
    ['histOrig', 'histTrans'].forEach(prefix => {
      const el = $(prefix + i);
      if (el) el.style.display = show ? '' : 'none';
    });
  }
}

// ── History queue ─────────────────────────────────────────────────────────
function renderHistQueue(type) {
  const isOrig = type === 'original';
  const q      = isOrig ? S.origHistQueue : S.transHistQueue;
  const prefix = isOrig ? 'histOrig' : 'histTrans';
  for (let i = 1; i <= MAX_HIST_SIZE; i++) {
    const el = $(prefix + i);
    if (el) el.textContent = (q[i - 1]?.text) ?? '';
  }
}

function setPreviousCaption(type, text) {
  const isOrig = type === 'original';
  const q      = isOrig ? S.origHistQueue : S.transHistQueue;

  while (q.length >= S.histSize) clearTimeout(q.pop().timer);

  const entry = { text, timer: null };
  entry.timer = setTimeout(() => {
    const idx = q.indexOf(entry);
    if (idx !== -1) { q.splice(idx, 1); renderHistQueue(type); }
  }, S.captionHoldMs);

  q.unshift(entry);
  renderHistQueue(type);
}

export function clearAllHistory() {
  S.origHistQueue.forEach(e  => clearTimeout(e.timer));
  S.transHistQueue.forEach(e => clearTimeout(e.timer));
  S.origHistQueue  = [];
  S.transHistQueue = [];
  renderHistQueue('original');
  renderHistQueue('translated');
}

export function updateImmediateCaption(type, nextText) {
  const isOrig    = type === 'original';
  const currentEl = $(isOrig ? 'originalText' : 'translatedText');
  const prevText  = isOrig ? S.lastImmediateOriginal : S.lastImmediateTranslated;

  if (shouldPromotePrevious(prevText, nextText)) {
    setPreviousCaption(type, prevText);
    // 記錄逐字稿（翻譯確認時才記，避免重複）
    if (!isOrig && prevText) logTranscript(S.lastImmediateOriginal, prevText);
  }
  currentEl.textContent = nextText;
  currentEl.classList.remove('partial');
  if (isOrig) S.lastImmediateOriginal   = nextText;
  else        S.lastImmediateTranslated = nextText;
}

// ── 下載逐字稿 ────────────────────────────────────────────────────────────
window.downloadTranscript = function() {
  if (S.transcriptLog.length === 0) return;
  const date = S.transcriptDate || new Date().toLocaleDateString('zh-TW');
  const lines = [`演唱會即時翻譯逐字稿`, `日期：${date}`, `共 ${S.transcriptLog.length} 段`, '', ''];
  for (const entry of S.transcriptLog) {
    lines.push(`[${entry.time}]`);
    if (entry.orig) lines.push(`原文：${entry.orig}`);
    lines.push(`翻譯：${entry.trans}`);
    lines.push('');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `逐字稿_${date.replace(/\//g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  saveTranscript(true);
};
