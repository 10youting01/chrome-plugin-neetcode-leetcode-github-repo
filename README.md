# LeetCode GitHub Pusher

一個第一階段 MVP Chrome extension：在 LeetCode 題目頁打開插件，確認目前程式碼與 GitHub 設定後，一鍵推送到指定 repo。

## 目前功能

- 偵測 LeetCode / NeetCode 題目頁的 slug、標題、難度與語言。
- 嘗試從 Monaco editor 讀取目前程式碼。
- NeetCode 會優先讀目前頁面的 CodeMirror editor；localStorage 只作為當前 slug 的 fallback，避免抓到上一題殘留程式碼。
- 支援手動修改程式碼內容後再推送。
- 使用 GitHub REST API 建立或更新根目錄解題檔案。
- 預設符合 `10youting01/leetcode-solutions` 的單檔命名格式，並優先使用題目標題。
- 可設定 owner、repo、branch、base folder、路徑模板。

## 安裝方式

1. 打開 Chrome 的 `chrome://extensions`。
2. 開啟右上角 `Developer mode`。
3. 點 `Load unpacked`。
4. 選這個資料夾。
5. 打開 LeetCode 或 NeetCode 題目頁，重新整理頁面，再開插件。

## GitHub token 權限

建議使用 fine-grained personal access token，只授權目標 repo：

- Repository access: 只選你的解題 repo。
- Repository permissions: `Contents` 設為 `Read and write`。

## 預設輸出

預設 repo：

```txt
10youting01/leetcode-solutions
```

預設路徑模板：

```txt
{id}.{title}.{ext}
```

例如 Two Sum 的 Python 解答會寫入：

```txt
1.Two-Sum.py
```

## 可用模板變數

- `{baseFolder}`
- `{platform}`
- `{id}`
- `{title}`
- `{displayTitle}`
- `{slug}`
- `{idSlug}`
- `{problemIdSlug}`
- `{difficulty}`
- `{language}`
- `{ext}`

## 下一階段候選功能

- Accepted 後自動推送。
- NeetCode 題單分類與更完整的 LeetCode 題號對應。
- 歷史 submissions 回填。
- README 進度表。
- GitHub OAuth 登入，不需要手動貼 token。
