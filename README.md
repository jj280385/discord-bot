# Discord 社群發文機器人

韓文原文 → Claude 翻譯成繁體中文並排版 → 待發文區人工審核 → 按 emoji 發到 Threads / Instagram。

```
#待整理  ──貼上原文 + 連結 + 圖片──▶  機器人呼叫 Claude
                                          │
#待發文區 ◀── 草稿（一篇共用貼文 + 字數 + 圖片）
   │
   ├─ ✏️ 編輯：跳出視窗直接改文字
   ├─ 🔄 重新生成
   └─ 按 emoji：✅ 全部　💬 Threads　📷 IG　📦 只搬不發　❌ 捨棄
                     │
                     ▼
         發布後草稿上會標示 ✅ 已發布 + 貼文連結
                     │
#已發文 ◀── 兩個平台都發完：草稿＋圖片＋貼文連結＋原文搬到這裡，待整理和待發文區清空
```

## 使用方式

1. 在 **#待整理** 頻道貼上：原文連結（第一個網址會當作原文連結）＋ 韓文原文，可以一起附最多 10 張圖片。
   - 原文太長時，Discord 會自動轉成 `message.txt` 附檔，機器人也讀得到。
   - 原文是圖片（例如公告截圖）也可以，Claude 會讀圖翻譯。
   - 可以用中文加上 `標題：…`、`Cr. …`，草稿會直接照用。
   - 還不確定能不能發的地方，直接在原文裡寫「待確認」「待補」等字，草稿會保留這些字，改掉之前不會發布。
2. 機器人會在原訊息按 ⏳，完成後改成 ✅，並把草稿送到 **#待發文區**。
3. 審稿人檢查草稿（同一篇會同時發到 Threads 和 IG）：
   - 標題列是目前字數。Threads 會把「— 留言區 —」以下的內容自動發成第一則回覆，主文超過 500 字也會自動拆成串文，標題會顯示「主文＋N 則回覆」；IG 也會把「— 留言區 —」以下發成第一則留言（分隔線本身不會出現在貼文裡），貼文說明超過 2200 字會出現 ⚠️，不會發出去。Claude 會完整照原文翻譯，不會為了字數自動刪減。
   - 「🔎 請確認」欄位是 Claude 不確定的人名或用語。
   - 貼文裡只要有「待確認」「確認中」「待審查」「待補」「待查」，按 emoji 都不會發布、也不會搬到 #已發文，機器人會回覆提醒你人工確認；按 ✏️ 編輯改掉後再按一次 emoji 即可（關鍵字在 `src/limits.js` 的 `PLACEHOLDER_WORDS`）。
   - 要改字就按 **✏️ 編輯**。
4. 按 emoji 發文：✅ 全部、💬 只發 Threads、📷 只發 IG、❌ 捨棄；📦 是不發布、直接搬到 #已發文（例如已經手動發過的貼文）。發布失敗時，草稿上會寫出原因；**取消 emoji 再按一次**就會重試。已經發過的平台不會重複發。
5. Threads 和 IG 都發完後，機器人會把貼文內容、圖片、兩個平台的貼文連結和韓文原文搬到 **#已發文**，並刪掉待發文區的草稿和待整理的原始訊息，這兩個頻道只會留下還沒處理完的內容（有設定 `PUBLISHED_CHANNEL_ID` 才會）。

只有 `REVIEWER_ROLE_IDS` 裡的身分組（或管理員）能按 emoji 和按鈕，其他人按的 emoji 會被自動移除。

## 調整翻譯與排版格式

| 檔案 | 用途 |
|---|---|
| `config/format.md` | 三個平台的貼文格式（**改這裡套用你們的格式**） |
| `config/glossary.json` | 韓文→中文專有名詞對照（成員名、團名、節目名） |

兩個檔案存檔後，下一篇草稿就會套用，不需要重開機器人（部署在雲端的話要重新部署）。

---

## 安裝設定

### 1. 建立 Discord 機器人

1. 到 [Discord Developer Portal](https://discord.com/developers/applications) → New Application。
2. **Bot** 頁面：按 Reset Token 取得 `DISCORD_TOKEN`，並打開 **Message Content Intent**。
3. **OAuth2 → URL Generator**：Scopes 勾 `bot`，權限勾：View Channels、Send Messages、Embed Links、Attach Files、Add Reactions、Read Message History、Manage Messages（用來移除非審稿人的 emoji）。用產生的網址把機器人邀進伺服器。
4. Discord 設定 → 進階 → 開啟「開發者模式」，對頻道和身分組按右鍵「複製 ID」，填入 `INPUT_CHANNEL_ID`、`REVIEW_CHANNEL_ID`、`PUBLISHED_CHANNEL_ID`、`REVIEWER_ROLE_IDS`。機器人在 #已發文 也需要 View Channels、Send Messages、Embed Links、Attach Files 權限。

### 2. Claude API

到 [Claude Console](https://console.anthropic.com) 建立 API key，填入 `ANTHROPIC_API_KEY`。

### 3. Threads

1. 到 [Meta for Developers](https://developers.facebook.com/apps) 建立 App，使用案例選 **Access the Threads API**。
2. 權限加入 `threads_basic`、`threads_content_publish`、`threads_manage_replies`（留言區和超過 500 字的內容要用來發回覆）。
3. App 角色 → 把你們的 Threads 帳號加為 **Threads Tester**，再到 Threads App「設定 → 帳號 → 網站權限 → 邀請」接受邀請。
4. 用 App 後台的 token 產生工具取得 token（`TH` 開頭；後台產生的可能已經是長效 token，可以直接用，換的時候出現 invalid 就不用換），再換成長效 token（60 天）：
   ```
   https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=<Threads 應用程式密鑰>&access_token=<短效 token>
   ```
   - 密鑰在 Threads 使用案例的「設定」頁，跟 App 主密鑰、IG 密鑰都不一樣。
   - 替換時連 `<` `>` 一起刪掉，網址中間不能有空格或換行。
5. 填入 `THREADS_ACCESS_TOKEN`。

> 只發自己的帳號、App 保持在開發模式即可，**不需要送 App 審查**。

### 4. Instagram

1. IG 帳號必須是**專業帳號**（商業或創作者）。
2. 在同一個（或新的）Meta App 加入使用案例 **Manage messaging & content on Instagram** → 選 **API setup with Instagram login**。
3. 加入 IG 帳號並按 Generate token（後台產生的就是 60 天長效 token），需要的權限是 `instagram_business_basic`、`instagram_business_content_publish`、`instagram_business_manage_comments`（留言區要用來發第一則留言）。
4. 填入 `IG_ACCESS_TOKEN`。

Threads 和 IG 的 token 機器人會自動續期（啟動時跟每 3 天一次），新 token 存在 `data/tokens.json`，**部署時要把 `data/` 掛成永久儲存空間**，否則重新部署後會退回 `.env` 裡的舊 token，60 天後過期。

### 5. 本機測試

```bash
cp .env.example .env     # 填好金鑰，先保持 DRY_RUN=true
npm install
npm start
```

`DRY_RUN=true` 時，按 emoji 只會在 log 印出內容、不會真的發文，可以安心測試整個流程。確認沒問題再改成 `false`。

```bash
npm test                 # 單元測試
```

### 6. 部署（Railway）

機器人要 24 小時開著才能收訊息，Discord 本身不提供代管，需要放在一台主機上。最簡單的是 [Railway](https://railway.com)：

1. 把這個資料夾推到 GitHub（`.env` 已在 `.gitignore`，不會被推上去）。
2. Railway → New Project → Deploy from GitHub repo，會自動用 `Dockerfile` 建置。
3. **Variables** 頁面貼上 `.env` 的內容。
4. **Volumes** → 新增 Volume，掛載路徑 `/app/data`（存自動續期的 token）。

其他可以跑 Docker 或 Node.js 20+ 的主機也都可以（`npm start` 或 `docker build` + `docker run -v ./data:/app/data --env-file .env`）。

---

## 目前的限制

- **Instagram 不能發純文字**，沒附圖時 IG 會發布失敗，其他平台不受影響。
- IG 的圖片比例必須在 4:5～1.91:1 之間，超出的話草稿上會先警告。
- 目前只支援圖片，不支援影片。
- 圖片在發布時是從 Discord 的圖片網址讓 Meta 下載。Discord 圖片網址大約 24 小時後會失效，但機器人每次發布前都會重新抓一次草稿，拿到新網址，所以舊草稿也能發。
- IG 最多 10 張、Threads 最多 20 張。

## 檔案結構

```
src/
  index.js            Discord 事件：收原文、emoji 發文、編輯/重新生成
  ai.js               呼叫 Claude 翻譯排版（照原文翻譯，字數超過只標示警告）
  prompt.js           翻譯指示（system prompt）
  review.js           草稿訊息的格式；草稿內容直接存在 Discord 訊息裡，不需要資料庫
  limits.js           各平台字數規則
  media.js            圖片轉 JPEG（IG 只收 JPEG）、比例檢查
  tokens.js           Threads / IG token 自動續期
  publish/            Threads、Instagram 發文
config/
  format.md           貼文格式
  glossary.json       專有名詞對照
```
