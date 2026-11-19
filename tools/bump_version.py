"""把 index.html 與 js/ 裡所有本機檔案引用的 ?v=版本號 統一改成新數字。

為什麼需要：手機瀏覽器會快取 js／css。只改了其中幾個檔、版本號卻沒換，
可能拿到「新的 A 檔 + 舊的 B 檔」，兩邊對不上，整頁打不開。
每個引用都帶同一個版本號，就能確保一次全部換新。
另外，同一個 js 檔在不同地方的引用路徑必須「一字不差」，
否則瀏覽器會把它當成兩個不同的檔各載入一次。

用法（在專案根目錄）：python tools/bump_version.py 11
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 只改 './xxx.js' 或 'js/xxx.js'、'css/xxx.css' 這類本機路徑，不碰 https:// 外部網址
PATTERN = re.compile(r"""(['"])((?:\./|js/|css/)[\w\-/]+\.(?:js|css))(?:\?v=\d+)?\1""")


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        sys.exit("用法：python tools/bump_version.py <新版本號數字>")
    ver = sys.argv[1]
    files = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]
    for f in files:
        text = f.read_text(encoding="utf-8")
        new, n = PATTERN.subn(lambda m: f"{m[1]}{m[2]}?v={ver}{m[1]}", text)
        if new != text:
            f.write_text(new, encoding="utf-8", newline="\n")
        print(f"{f.relative_to(ROOT)}：{n} 處")


if __name__ == "__main__":
    main()
