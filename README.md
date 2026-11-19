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
| `js/session.js` | Gemini Live 連線、收訊息、費用計算、重連 |
| `js/mic.js` | 麥克風收音與轉檔 |
| `js/captions.js` | 字幕顯示、逐字稿 |
| `js/settings.js` | 設定畫面、藝人快速設定 |
| `js/config.js` | 固定設定：人名對照表、預設提示詞、費率、模型名稱 |
| `js/state.js` | 各檔共用的執行狀態 |

## 部署

靜態頁面，GitHub Pages 直接讀 `index.html`，`git push` 後幾分鐘內自動更新。
改了 css／js 時，把 `index.html` 裡 `?v=` 後面的數字加 1，避免手機讀到舊的快取檔。

## 本機測試

用了 ES module（＝瀏覽器原生的「多個 js 檔互相引用」機制），不能直接雙擊 `index.html` 開啟，要用本機伺服器：`python -m http.server 8000`，再開 http://localhost:8000
