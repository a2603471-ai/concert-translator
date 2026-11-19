// 各模組共用的執行狀態（集中放一個物件，避免每個檔各存一份、互相不同步）

export const S = {
  histSize: 3,

  liveSession:   null,
  audioContext:  null,
  processor:     null,
  micStream:     null,
  running:       false,
  timerInterval: null,
  wakeLock:      null,

  sessionStart:      0,
  totalInputTok:     0,
  totalOutputTok:    0,
  origBuffer:        '',
  transBuffer:       '',
  segFlushTimer:     null,
  currentCostTwd:    0,
  costLimitTwd:      0,
  autoStoppedByCost: false,
  audioChunkCount:   0,
  silentChunkCount:  0,
  lastAudioLevel:    0,
  lastInputAt:       0,
  lastOutputAt:      0,
  captionHoldMs:     12000,
  lastImmediateOriginal:   '',
  lastImmediateTranslated: '',

  // 字幕歷史佇列：index 0 = 最新
  origHistQueue:  [],
  transHistQueue: [],

  // 逐字稿、熱切換
  transcriptLog:     [],   // { time, orig, trans }
  hotswapTimer:      null,
  hotswapIntervalMs: 0,
  isHotswapping:     false,
  currentAi:         null,
  currentConfig:     null,

  lastArtistValue: '__MAMAMOO__',
};

export const $ = id => document.getElementById(id);

export function setStatus(msg, type = '') {
  const el = $('status');
  el.textContent = msg;
  el.className   = 'status ' + type;
}
export function showError(msg) {
  const b = $('errorBox');
  b.textContent   = msg;
  b.style.display = 'block';
}
export function hideError() { $('errorBox').style.display = 'none'; }
