// 連線管理：建立 Gemini Live 連線、斷線自動接回、熱切換
//
// 為什麼需要：Google 規定每條連線約 10 分鐘就會被切斷，純語音對話最長 15 分鐘。
// 以前一斷線就整個停止；現在改成自動接回，並用「接續碼」(resumption handle) 延續同一段對話。
//
// 每次連線都有編號 connId。只有「編號等於目前 S.connId」的連線算數：
// 舊連線事後才送來的訊息、斷線通知、或晚一步才接通，一律忽略並關掉，
// 避免「新連線已接上，舊連線又把它蓋掉／把翻譯停掉」。

import { S, setStatus, showError } from './state.js?v=10';
import { MODELS } from './config.js?v=10';
import { handleMessage } from './session.js?v=10';
import { startMic, ensureMic } from './mic.js?v=10';

const MAX_RECONNECT    = 10;      // 連續失敗幾次才放棄（約 1 分鐘）
const SETUP_TIMEOUT_MS = 15000;   // 連線打開後超過這麼久還沒完成設定，視為斷線
const EXTENDED = { contextWindowCompression: { slidingWindow: {} } };  // 模型若不支援會自動退回

function buildConfig(useHandle) {
  const cfg = { ...S.currentConfig };
  if (!S.extendedOff) {
    cfg.contextWindowCompression = EXTENDED.contextWindowCompression;
    cfg.sessionResumption = (useHandle && S.resumeHandle) ? { handle: S.resumeHandle } : {};
  }
  return cfg;
}

function onMessageFor(id) {
  return (message) => {
    if (id !== S.connId || !S.running) return;
    if (message.setupComplete) {
      S.setupOk = true;
      S.everConnected = true;
      S.reconnectAttempts = 0;
      setStatus('● 翻譯中', 'active');
      ensureMic();   // iPhone 從背景回來時，麥克風可能已被系統暫停
    }
    const upd = message.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) S.resumeHandle = upd.newHandle;
    if (message.goAway) { reconnect('goAway', true); return; }  // 伺服器預告要斷線，先主動換線
    handleMessage(message);
  };
}

function onCloseFor(id) {
  return (e) => {
    if (id !== S.connId || !S.running) return;
    const reason = e?.reason || S.lastErrorMsg || '';
    S.lastErrorMsg = '';

    // 第一次連線就在設定階段被拒：多半是模型不支援延長設定 → 退回基本設定再試一次
    if (!S.setupOk && !S.everConnected && !S.extendedOff) {
      S.extendedOff = true;
      reconnect('fallback', false);
      return;
    }
    // 從沒成功連上過：通常是 Key 或模型有問題，重試也沒用
    if (!S.setupOk && !S.everConnected) {
      failAndStop('連線失敗' + (reason ? `：${reason}` : '（請確認 API Key 是否正確）'));
      return;
    }
    // 接續碼可能失效：連續失敗 2 次就改開全新對話
    if (!S.setupOk && S.reconnectAttempts >= 2) S.resumeHandle = null;
    reconnect('closed', true, reason);
  };
}

function failAndStop(msg) {
  showError(msg);
  setStatus('連線中斷', 'error');
  window.stopTranslation();
}

// ── 建立連線 ──────────────────────────────────────────────────────────────
// 回傳連線物件；若等待期間已過期（有更新的連線、或使用者按了停止）就關掉並回傳 null
export async function connectSession(useHandle) {
  const id = ++S.connId;
  S.setupOk = false;
  // 換線：把上一條連線的 token 收進合計，新連線從 0 開始算
  S.tokBaseIn  += S.connInTok;  S.connInTok  = 0;
  S.tokBaseOut += S.connOutTok; S.connOutTok = 0;

  // 看門狗：網路差時可能「連線打開了，但設定一直沒完成」，卡住就當成斷線處理
  setTimeout(() => {
    if (id === S.connId && S.running && !S.setupOk) onCloseFor(id)({ reason: '連線逾時' });
  }, SETUP_TIMEOUT_MS);

  const session = await S.currentAi.live.connect({
    model: (MODELS[S.modelKey] || MODELS.translate).id,
    config: buildConfig(useHandle),
    callbacks: {
      onopen: async () => {
        if (id !== S.connId || !S.running || S.micStream) return;
        try { await startMic(); }
        catch (err) {
          showError('麥克風錯誤：' + err.message);
          setStatus('麥克風失敗', 'error');
          window.stopTranslation();
        }
      },
      onmessage: onMessageFor(id),
      onerror:   (e) => { if (id === S.connId) S.lastErrorMsg = e?.message || ''; },
      onclose:   onCloseFor(id),
    }
  });

  if (id !== S.connId || !S.running) {
    try { session.close(); } catch (_) {}
    return null;
  }
  return session;
}

// ── 重連（斷線、伺服器預告、熱切換共用）──────────────────────────────────
// useHandle=true：帶接續碼，延續原本的對話；false：開一段全新對話
export async function reconnect(kind, useHandle, reason = '') {
  if (!S.running || !S.currentAi) return;

  const oldSession = S.liveSession;
  S.liveSession = null;              // 讓麥克風暫停送資料
  const myId = ++S.connId;           // 舊連線之後的通知全部作廢
  try { oldSession?.close(); } catch(_) {}

  let delay = 300;
  if (kind === 'closed') {
    S.reconnectAttempts++;
    if (S.reconnectAttempts > MAX_RECONNECT) {
      failAndStop(`連線中斷，自動重連 ${MAX_RECONNECT} 次都失敗` + (reason ? `：${reason}` : '，請檢查網路'));
      return;
    }
    delay = Math.min(500 * 2 ** (S.reconnectAttempts - 1), 8000);
    setStatus(`斷線，自動重連中（第 ${S.reconnectAttempts} 次）…`, '');
  } else if (kind !== 'fallback') {
    setStatus('重連中…', '');
  }

  await new Promise(r => setTimeout(r, delay));
  if (!S.running || S.connId !== myId) return;   // 等待期間被停止，或另一個重連已接手

  try {
    const session = await connectSession(useHandle);
    if (session) S.liveSession = session;
  } catch (err) {
    if (S.running && S.connId === myId + 1) reconnect('closed', useHandle, err.message);
  }
}

// ── 熱切換重連（防延遲：定時開一段全新對話）────────────────────────────────
export function hotswapReconnect() {
  S.resumeHandle = null;   // 刻意開新對話，舊接續碼不再使用
  return reconnect('hotswap', false);
}
