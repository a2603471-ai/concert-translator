# 演唱會即時翻譯

手機開網頁就能用的演唱會即時翻譯：用麥克風收現場語音，透過 Gemini Live API（`gemini-3.5-live-translate-preview`）即時翻譯成中文字幕。

- 線上網址：https://a2603471-ai.github.io/concert-translator/
- 純前端，Gemini API Key 由使用者自行輸入、存在瀏覽器本機（不會存進程式碼或上傳）

## 檔案結構

| 檔案 | 負責什麼 |
|---|---|
| `index.html` | 畫面元素 |
| `css/style.css` | 樣式 |
| `js/main.js` | 進入點：開始／停止翻譯 |
| `js/connection.js` | 建立 Gemini Live 連線、斷線自動接回、熱切換 |
| `js/session.js` | 收伺服器訊息、費用計算、狀態燈號、防螢幕熄滅 |
| `js/glossary-ai.js` | AI 自動產生藝人人名對照表 |
| `tools/bump_version.py` | 統一更新快取版本號 |
| `js/mic.js` | 麥克風收音與轉檔 |
| `js/captions.js` | 字幕顯示、逐字稿 |
| `js/settings.js` | 設定畫面、藝人快速設定 |
| `js/config.js` | 固定設定：人名對照表、預設提示詞、費率、模型名稱 |
| `js/state.js` | 各檔共用的執行狀態 |

## 部署

靜態頁面，GitHub Pages 直接讀 `index.html`，`git push` 後幾分鐘內自動更新。
改了 css／js 時，推上去前執行 `python tools/bump_version.py <新數字>`（目前是 10），
一次把 `index.html` 和 js 檔裡所有 `?v=` 版本號換新，避免手機讀到「新舊混雜」的快取檔而整頁打不開。
**不要手動只改其中幾個**：同一個 js 檔的引用路徑必須一字不差，否則瀏覽器會把它載入兩次。

## 本機測試

用了 ES module（＝瀏覽器原生的「多個 js 檔互相引用」機制），不能直接雙擊 `index.html` 開啟，要用本機伺服器：`python -m http.server 8000`，再開 http://localhost:8000
