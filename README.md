# OV Streaming WebRTC Viewer

以 NVIDIA `@nvidia/ov-web-rtc` 6.x、Isaac Sim Kit 與 OpenUSD 建立的瀏覽器 Viewer。支援 Windows／Ubuntu、Isaac Sim 5.1 與 6.0.x（包含 6.0.2），並提供低 VRAM 的 Isaac Sim 6 Minimal experience。

前端除了 WebRTC 畫面，也能透過 application message API 與 Kit backend 雙向互動：開啟 USD、讀取 Stage tree、同步選取物件，以及在 viewport 點選物件時執行平滑升降效果。

## 版本選擇

| Experience | Isaac Sim | 用途 |
| --- | --- | --- |
| `ov.web.viewer.5.1.kit` | 5.1 | 舊專案相容；WebRTC 影像搭配 WebSocket control API |
| `ov.web.viewer.6.0.kit` | 6.0.x / 6.0.2 | 載入 `isaacsim.exp.full` 的完整 runtime |
| `ov.web.viewer.6.0.minimal.kit` | 6.0.x / 6.0.2 | 建議選項；只載入 RTX viewport、選取、串流與 viewer backend |

Minimal 不包含 PhysX、機器人、感測器、Replicator、Isaac Lab 或完整 Editor UI。專案需要這些功能時，可改用 full experience，或逐項加入必要 extension。

目前已在 Windows 上實機驗證 Isaac Sim 5.1 與 6.0.1。6.0.2 使用相同的 6.0.x experience 與可設定 launcher；建議部署前仍在目標 6.0.2 主機執行一次 smoke test。

## 功能

- WebRTC viewport、滑鼠與鍵盤輸入
- 開啟本機、HTTP 或 Omniverse USD
- 延遲載入 OpenUSD Stage tree
- 網頁與 viewport 雙向 selection focus
- 點選 viewport 物件後平滑升起／降下
- 隱藏 viewport HUD/GPU 統計資訊
- Windows PowerShell 與 Ubuntu shell launchers

## 必要環境

- Isaac Sim 5.1 或 6.0.x 已安裝於執行 Kit 的主機
- NVIDIA RTX GPU、可用的 NVENC 與相容驅動
- GPU 必須有 active display；若為 headless 主機，可使用 dummy display plug
- Node.js 20+、npm 10+（建置網頁使用）
- Python 3（Ubuntu production static server 使用）

> 本 repo 不包含 Isaac Sim、Isaac assets、`node_modules` 或 NVIDIA npm package bundle。`npm ci` 會依 `.npmrc` 從 NVIDIA registry 取得 `@nvidia/ov-web-rtc`。

## 安裝前端

```bash
git clone https://github.com/tommywu052/ov_streaming_webrtc.git
cd ov_streaming_webrtc
npm ci
```

開發伺服器：

```bash
npm run dev
```

瀏覽器開啟 `http://127.0.0.1:5173`。

## Windows

Isaac Sim 6.0.x Minimal（建議）：

```powershell
$env:ISAAC_ROOT = 'C:\Nvidia\isaac-sim-standalone-6.0.2-windows-x86_64'
npm run start:viewer:minimal
```

Isaac Sim 6.0.x Full：

```powershell
$env:ISAAC_ROOT = 'C:\Nvidia\isaac-sim-standalone-6.0.2-windows-x86_64'
npm run start:viewer:6
```

Isaac Sim 5.1：

```powershell
$env:ISAAC_ROOT = 'C:\Nvidia\isaac-sim-standalone-5.1.0-windows-x86_64'
npm run start:viewer:5.1
```

5.1 的網頁需在另一個 Terminal 使用相容 mode：

```powershell
npm run dev:5.1
```

所有 Windows 版本也可直接傳入參數：

```powershell
.\scripts\windows\start-viewer.ps1 `
  -IsaacVersion 6.0 `
  -Minimal `
  -IsaacRoot 'D:\isaacsim-6.0.2' `
  -PublicIp 192.168.1.50 `
  -ActiveGpu 0
```

## Ubuntu

先建立設定：

```bash
cp scripts/linux/viewer.env.example viewer.env
nano viewer.env
chmod +x scripts/linux/*.sh
./scripts/linux/check-system.sh
```

`viewer.env` 最少需確認：

```bash
ISAAC_ROOT="$HOME/isaacsim"
ISAAC_HOST="127.0.0.1"
```

瀏覽器位於另一台電腦時，將 `ISAAC_HOST` 設為 Ubuntu 主機 LAN IP。

啟動 Isaac Sim 6 Minimal：

```bash
./scripts/linux/start-viewer-6.sh
```

如要改用 full experience，在 `viewer.env` 加入：

```bash
VIEWER_EXPERIENCE="ov.web.viewer.6.0.kit"
```

Isaac Sim 5.1：

```bash
./scripts/linux/start-viewer-5.1.sh
npm run dev:5.1
```

Production web client：

```bash
npm run build
./scripts/linux/start-web.sh
```

## Client / Server API

Isaac Sim 6 使用 WebRTC application message；Isaac Sim 5.1 使用相同 JSON model 的 localhost WebSocket compatibility channel（port `8211`）。

Requests：

- `viewer:get-stage`
- `viewer:get-children`
- `viewer:open-stage`
- `viewer:reload-stage`
- `viewer:select-prim`

Backend events：

- `viewer:selection-changed`
- `viewer:stage-changed`
- `viewer:interaction`

5.1 control WebSocket 預設只綁定 `127.0.0.1`，因此 5.1 模式預設要求瀏覽器與 Isaac Sim 位於同一台主機。

## 網路連接埠

| Port | Protocol | 用途 |
| --- | --- | --- |
| 49100 | TCP | WebRTC signaling |
| 47998 | UDP | Isaac Sim 6 media/input |
| 5173 | TCP | Vite 或 production static web server |
| 8211 | TCP | Isaac Sim 5.1 localhost control API |

串流服務本身不提供完整的公開網路驗證與 TLS。跨機器使用時應限制防火牆來源，或放在 VPN／受控網路後方。

## USD 與 assets

repo 不包含 Isaac Sim assets。分享自訂 USD 時，請一併提供其 sublayers、payloads、meshes、textures 與 materials，並保留相對路徑。網頁輸入的本機路徑是 **Isaac Sim 主機上的路徑**，不是瀏覽器電腦的路徑。

## 常見問題

### `Failed to create video stream 0`

確認：

```bash
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free,display_active --format=csv,noheader
ldconfig -p | grep libnvidia-encode
```

若 GPU 記憶體有限，先使用 Minimal experience，關閉其他使用 GPU 的 Isaac Sim／渲染程式，並確認螢幕或 dummy plug 接在執行串流的 NVIDIA GPU。

### 網頁連得到 signaling，但隨即 `SERVER_DISCONNECTED`

檢查 Kit terminal 的第一個 Fatal/Error。常見原因為 NVENC 無法建立 stream、UDP 47998 被防火牆阻擋，或已有另一個 client 佔用 session。

## License

請參閱 [LICENSE.txt](LICENSE.txt) 與 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。NVIDIA packages 依各自授權條款由 NVIDIA registry 安裝，未包含於本 repository。
