// 設定畫面：讀寫 localStorage、藝人快速設定、折疊區塊

import { S, $ } from './state.js?v=10';
import { MAMAMOO_GLOSSARY, SUPERJUNIOR_GLOSSARY, DEFAULT_SYS_PROMPT, CAPTION_HISTORY_VERSION } from './config.js?v=10';
import { updateHistSlotVisibility } from './captions.js?v=10';

// ── Artist presets ────────────────────────────────────────────────────────
function loadUserArtists() {
  try { return JSON.parse(localStorage.getItem('user_artists') || '[]'); }
  catch { return []; }
}
function saveUserArtists(arr) {
  localStorage.setItem('user_artists', JSON.stringify(arr));
}

function renderArtistSelect() {
  const sel = $('artistPreset');
  const cur = sel.value;
  sel.innerHTML = '';
  const add = (text, val) => sel.add(new Option(text, val));
  add('MAMAMOO（預設）', '__MAMAMOO__');
  add('Super Junior（內建）', '__SUPERJUNIOR__');
  loadUserArtists().forEach((a, i) => add(a.name, `__user_${i}__`));
  add('＋ 新增藝人…', '__ADD__');
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function applyArtistGlossary(glossary) {
  const ta = $('sysPrompt');
  const next = ta.value.replace(
    /<artist_glossary>[\s\S]*?<\/artist_glossary>/,
    `<artist_glossary>\n${glossary}\n</artist_glossary>`
  );
  if (next === ta.value) {
    alert('找不到 <artist_glossary> 標籤，請先按「↺ 重設為預設提示詞」，再重新選擇藝人。');
    return;
  }
  ta.value = next;
  localStorage.setItem('sys_prompt', next);
}

window.saveNewArtist = function() {
  const name     = $('newArtistName').value.trim();
  const glossary = $('newArtistGlossary').value.trim();
  if (!name)     { alert('請填入藝人名稱'); return; }
  if (!glossary) { alert('請填入人名對照表'); return; }
  const users = loadUserArtists();
  users.push({ name, glossary });
  saveUserArtists(users);
  $('addArtistForm').style.display = 'none';
  $('newArtistName').value     = '';
  $('newArtistGlossary').value = '';
  renderArtistSelect();
  const newVal = `__user_${users.length - 1}__`;
  $('artistPreset').value = newVal;
  S.lastArtistValue = newVal;
  localStorage.setItem('selected_artist', newVal);
  applyArtistGlossary(glossary);
  $('artistDeleteRow').style.display = 'block';
};

window.cancelAddArtist = function() {
  $('addArtistForm').style.display = 'none';
  $('newArtistName').value     = '';
  $('newArtistGlossary').value = '';
};

// ── Init ──────────────────────────────────────────────────────────────────
// 強制重置 iOS 縮放（防止上次測試留下的放大狀態）
{
  const meta = document.querySelector('meta[name=viewport]');
  const base = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, user-scalable=no';
  meta.setAttribute('content', base + ', maximum-scale=1.0');
  setTimeout(() => meta.setAttribute('content', base), 300);
}

export function initSettings() {
  const savedKey    = localStorage.getItem('gemini_key');
  const savedPrompt = localStorage.getItem('sys_prompt');
  if (localStorage.getItem('caption_history_version') !== CAPTION_HISTORY_VERSION) {
    localStorage.setItem('ai_segment', 'false');
    localStorage.setItem('caption_history_version', CAPTION_HISTORY_VERSION);
  }
  const savedSeg          = localStorage.getItem('ai_segment') === 'true';
  const savedNoise        = localStorage.getItem('noise_suppression');
  const savedLimit        = localStorage.getItem('cost_limit_twd');
  const savedHold         = localStorage.getItem('caption_hold_sec');
  const savedSrcLang      = localStorage.getItem('source_lang');
  const savedHotswap      = localStorage.getItem('hotswap_interval');
  const savedDisplayLines = localStorage.getItem('display_lines');

  if (savedKey) {
    $('apiKey').value = savedKey;
  } else {
    $('apiHelpBody').classList.add('open');
  }
  $('sysPrompt').value = savedPrompt ?? DEFAULT_SYS_PROMPT;
  $('aiSegment').checked = savedSeg;
  if (savedNoise        != null) $('noiseSuppression').value = savedNoise;
  if (savedLimit        != null) $('costLimit').value = savedLimit;
  if (savedHold         != null) $('captionHold').value = savedHold;
  if (savedSrcLang      != null) $('sourceLang').value = savedSrcLang;
  if (savedHotswap      != null) $('hotswapInterval').value = savedHotswap;
  if (savedDisplayLines != null) $('displayLines').value = savedDisplayLines;
  const savedModel = localStorage.getItem('model_choice');
  if (savedModel != null) $('modelChoice').value = savedModel;
  S.histSize = Number($('displayLines').value);
  updateHistSlotVisibility();
  refreshSegDesc();

  renderArtistSelect();
  const savedArtist = localStorage.getItem('selected_artist') || '';
  if (savedArtist) {
    const sel = $('artistPreset');
    if ([...sel.options].some(o => o.value === savedArtist)) {
      sel.value = savedArtist;
      S.lastArtistValue = savedArtist;
      if (savedArtist.startsWith('__user_')) $('artistDeleteRow').style.display = 'block';
    }
  }
}

$('apiKey').addEventListener('input', e =>
  localStorage.setItem('gemini_key', e.target.value.trim()));
$('sysPrompt').addEventListener('input', e =>
  localStorage.setItem('sys_prompt', e.target.value));

window.toggleApiHelp = function() {
  $('apiHelpBody').classList.toggle('open');
};

window.resetSysPrompt = function() {
  if (!confirm('確定要重設為預設提示詞？目前的修改將會清除。')) return;
  localStorage.removeItem('sys_prompt');
  $('sysPrompt').value = DEFAULT_SYS_PROMPT;
  $('artistPreset').value = '__MAMAMOO__';
  S.lastArtistValue = '__MAMAMOO__';
  localStorage.setItem('selected_artist', '__MAMAMOO__');
  $('artistDeleteRow').style.display = 'none';
};
$('aiSegment').addEventListener('change', () => {
  localStorage.setItem('ai_segment', $('aiSegment').checked);
  refreshSegDesc();
  if (S.running) {
    clearTimeout(S.segFlushTimer); S.segFlushTimer = null;
    S.origBuffer = ''; S.transBuffer = '';
    $('originalText').classList.remove('partial');
    $('translatedText').classList.remove('partial');
  }
});
const persist = (id, key) => $(id).addEventListener('change', e => localStorage.setItem(key, e.target.value));
persist('noiseSuppression', 'noise_suppression');
persist('costLimit',        'cost_limit_twd');
persist('captionHold',      'caption_hold_sec');
persist('sourceLang',       'source_lang');
persist('hotswapInterval',  'hotswap_interval');
persist('modelChoice',      'model_choice');
$('displayLines').addEventListener('change', e => {
  localStorage.setItem('display_lines', e.target.value);
  S.histSize = Number(e.target.value);
  updateHistSlotVisibility();
});

$('artistPreset').addEventListener('change', function() {
  const val = this.value;
  if (val === '__ADD__') {
    this.value = S.lastArtistValue;
    $('addArtistForm').style.display = 'block';
    return;
  }
  S.lastArtistValue = val;
  localStorage.setItem('selected_artist', val);
  const isUser = val.startsWith('__user_');
  $('artistDeleteRow').style.display = isUser ? 'block' : 'none';
  if (val === '__MAMAMOO__')     { applyArtistGlossary(MAMAMOO_GLOSSARY); return; }
  if (val === '__SUPERJUNIOR__') { applyArtistGlossary(SUPERJUNIOR_GLOSSARY); return; }
  if (isUser) {
    const idx = parseInt(val.replace('__user_', ''));
    const a = loadUserArtists()[idx];
    if (a) applyArtistGlossary(a.glossary);
  }
});

$('artistDeleteBtn').addEventListener('click', function() {
  const val = $('artistPreset').value;
  if (!val.startsWith('__user_')) return;
  if (!confirm('確定刪除這個藝人設定？')) return;
  const idx = parseInt(val.replace('__user_', ''));
  const users = loadUserArtists();
  users.splice(idx, 1);
  saveUserArtists(users);
  $('artistPreset').value = '__MAMAMOO__';
  S.lastArtistValue = '__MAMAMOO__';
  localStorage.setItem('selected_artist', '__MAMAMOO__');
  $('artistDeleteRow').style.display = 'none';
  renderArtistSelect();
});

// ── UI helpers ────────────────────────────────────────────────────────────
function refreshSegDesc() {
  const on = $('aiSegment').checked;
  $('aiSegmentDesc').textContent = on
    ? '開啟：內容穩定後自動收句，完整句移到上方保留'
    : '關閉：即時顯示，上一段字幕會保留';
}

window.toggleAdvanced = function() {
  const body = $('advancedBody');
  const open = !body.classList.contains('open');
  body.classList.toggle('open', open);
  $('advancedArrow').classList.toggle('open', open);
  $('advancedTrigger').classList.toggle('open', open);
};

window.toggleSysPrompt = function() {
  const body = $('sysBody');
  const open = !body.classList.contains('open');
  body.classList.toggle('open', open);
  $('sysArrow').classList.toggle('open', open);
};
