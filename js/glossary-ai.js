// AI 自動產生藝人人名對照表：輸入藝人名稱 → 用文字模型產生成員中韓英對照
// 產生結果只填進輸入框，使用者核對、修改後按「儲存」才會生效

import { GoogleGenAI } from 'https://esm.sh/@google/genai@2.32.0';
import { $ } from './state.js?v=12';
import { GLOSSARY_MODELS } from './config.js?v=12';

const buildPrompt = name =>
`請列出藝人／團體「${name}」的成員人名對照表，給演唱會即時翻譯使用。

輸出規則：
- 第一行固定為：本場演唱會藝人名稱對照（翻譯時優先使用此表，不得自行改動）：
- 空一行後，先列「${name} 藝名：」，每位成員一行，格式：- 英文藝名 / 原文（韓文或日文）→ 台灣常用中文譯名
- 若成員本名和藝名不同，再空一行列「${name} 本名：」，格式相同
- 中文譯名使用台灣粉絲與媒體最常用的寫法，不要用中國大陸譯名
- 不確定的譯名在該行最後加「（待確認）」
- 若是個人歌手，只列他本人一行
- 只輸出對照表本身，不要任何說明、開場白或 Markdown 標記
- 如果你不認識這位藝人，只輸出：查無此藝人`;

// 模型忙碌（503）或額度暫滿（429）是 Google 端暫時性問題：
// 同一個模型等一下再試一次，還不行就換下一個備用模型。
// 模型忙的時候也可能「完全不回應」，所以每次最多等 TIMEOUT_MS，逾時就換下一個
// （2026-11-19 iPhone 實測：沒設上限時按鈕一直卡在「產生中」）
const TIMEOUT_MS = 30000;
const TIMEOUT_MSG = 'TIMEOUT';
const isBusy = err => /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|TIMEOUT/i.test(err?.message || '');
const isMissing = err => /\b404\b|NOT_FOUND/i.test(err?.message || '');   // 模型已下架
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callWithTimeout(ai, model, contents) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await ai.models.generateContent({ model, contents, config: { abortSignal: ctrl.signal } });
  } catch (err) {
    throw ctrl.signal.aborted ? new Error(TIMEOUT_MSG) : err;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWithFallback(ai, contents, note) {
  let lastErr;
  for (const [i, model] of GLOSSARY_MODELS.entries()) {
    if (i > 0) note.textContent = `主要模型忙碌，改用備用模型（${i}/${GLOSSARY_MODELS.length - 1}）…`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callWithTimeout(ai, model, contents);
      } catch (err) {
        lastErr = err;
        if (isMissing(err) || err.message === TIMEOUT_MSG) break;  // 下架或逾時：直接換下一個
        if (!isBusy(err)) throw err;      // Key 錯、格式錯：重試也沒用
        if (attempt === 0) await sleep(1500);
      }
    }
  }
  throw lastErr;
}

window.generateGlossary = async function() {
  const name   = $('newArtistName').value.trim();
  const apiKey = $('apiKey').value.trim();
  const note   = $('aiGlossaryNote');
  const btn    = $('aiGlossaryBtn');
  if (!name)   { alert('請先填入藝人名稱'); return; }
  if (!apiKey) { alert('請先在上方填入 Gemini API Key'); return; }
  if ($('newArtistGlossary').value.trim() &&
      !confirm('對照表已經有內容，要用 AI 產生的結果取代嗎？')) return;

  btn.disabled = true;
  btn.textContent = '⏳ 產生中…';
  note.textContent = '通常 10～30 秒；模型忙碌時會自動換備用模型';
  const started = Date.now();
  const ticker  = setInterval(() => {
    btn.textContent = `⏳ 產生中…已等 ${Math.round((Date.now() - started) / 1000)} 秒`;
  }, 1000);
  try {
    const ai   = new GoogleGenAI({ apiKey });
    const res  = await generateWithFallback(ai, buildPrompt(name), note);
    const text = (res.text || '').trim();
    if (!text || text.includes('查無此藝人')) {
      note.textContent = `AI 不認識「${name}」，請手動填寫對照表`;
      return;
    }
    $('newArtistGlossary').value = text;
    note.textContent = '✅ 已產生。AI 可能寫錯譯名，請逐行核對（標「待確認」的特別注意），沒問題再按儲存';
  } catch (err) {
    note.textContent = isBusy(err)
      ? 'Google 的 AI 模型目前都很忙或沒有回應，請過幾分鐘再按一次，或先手動填寫'
      : '產生失敗：' + err.message;
  } finally {
    clearInterval(ticker);
    btn.disabled = false;
    btn.textContent = '✨ 用 AI 自動產生人名對照表';
  }
};
