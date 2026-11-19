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
  tokBaseIn:         0,   // 之前各條連線的 token 合計
  tokBaseOut:        0,
  connInTok:         0,   // 目前這條連線的 token
  connOutTok:        0,
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
  transcriptDate:    '',
  modelKey:          'translate',   // 'translate' 或備援 'live'，見 config.js MODELS
  hotswapTimer:      null,
  hotswapIntervalMs: 0,
  currentAi:         null,
  currentConfig:     null,

  // 斷線自動接回
  connId:            0,      // 目前有效的連線編號
  setupOk:           false,  // 這條連線是否已完成設定
  everConnected:     false,  // 本次翻譯是否至少成功接上過一次
  extendedOff:       false,  // 模型不支援延長對話設定時改 true
  resumeHandle:      null,   // 伺服器給的接續碼
  reconnectAttempts: 0,
  lastErrorMsg:      '',

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
