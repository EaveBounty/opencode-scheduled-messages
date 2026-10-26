# opencode-scheduled-messages

**给 OpenCode V2 的指定会话定时发消息：白天写，低峰发。**

[English](README.md) · [项目主页](https://eavebounty.github.io/opencode-scheduled-messages/) · [PolyForm Noncommercial 1.0.0](LICENSE)

OpenCode V2 有完整的 HTTP API，但没有 cron 或延时发送。现有工具大多在每次任务时**新建会话**，想法就丢了原来的上下文。这个项目反过来：把一句话排队到**你指定的已有会话**（也可以新建），到点通过官方 V2 API 发进去。

单进程、零运行时依赖、移动优先 PWA、SQLite 队列。不改 OpenCode、不注入它的页面、不读它 900 MB 的数据库。

```
手机 / 电脑  ──HTTPS/Tailscale──►  ocsched :8788
                                   ├─ /        自己的 PWA
                                   ├─ /api/*   网关（服务端注入 Basic 认证）
                                   └─ 调度器 + SQLite
                                          │
                                          ▼
                                   OpenCode V2 :4096
```

## 为什么做这个

- **续写已有会话，而不是每次开新会话。** 核心 API 是 `POST /api/session/{id}/prompt`。
- **持久化。** SQLite + 10 秒 tick；重启后按宽限窗口补发，不会静默丢任务。
- **失败可见。** 会话忙就等；OpenCode 离线就重试；超过宽限标记“已错过”，不把半夜的想法中午突然发出去。
- **手机优先。** ~80 KB 级 PWA、底部输入框、安全区适配、可安装。
- **完整视图不重造。** 一键跳到 OpenCode 原生会话页（深链），保留全部工具输出、diff、图片。
- **零依赖。** `node:http` + `node:sqlite` + 原生 `fetch`，`npm pack` 约 150 KB。

## 功能

| | |
|---|---|
| 会话列表 | 跨项目列出根会话，显示运行/空闲、模型、最后活动、成本与 token |
| 已有会话发送 | 客户端生成 `msg_` id，服务端幂等 |
| 新建会话发送 | 可指定标题、目录、模型、agent，再发送 |
| 一次性定时 | 存绝对 UTC + 原始 IANA 时区；手机端按本地时区选择 |
| 忙闲策略 | 等空闲（默认 30 分钟）/ 插入当前轮 / 跳过 |
| 宽限窗口 | 机器关机后 120 分钟内才补发，超时转人工 |
| 权限策略 | 每条任务单独设置：等我处理（默认）/ 超时拒绝 / 只读自动放行 / 全部放行 |
| 实时更新 | 复用 OpenCode SSE，调度事件推送到所有页面 |
| 移动端 | Manifest、Service Worker、深/浅色、44px 触控、iOS 安全区 |
| 局域网 / Tailscale / Cloudflare | 默认只绑 127.0.0.1；`--lan` 给同 Wi-Fi 手机；任意 HTTPS 反代均可 |
| DeepSeek 峰谷提示 | 按官方 UTC 时段显示“峰时/谷时”，不承诺省钱 |

## 快速开始

要求：**Node.js ≥ 22.6**，以及正在运行的 **OpenCode V2**。

```bash
# 1. 确认 OpenCode 服务在跑
opencode serve --service        # 通常已由 opencode.service 托管

# 2. 启动调度器
npx opencode-scheduled-messages

# 或全局安装
npm install -g opencode-scheduled-messages
ocsched
```

首次启动会打印一次性访问令牌：

```
────────────────────────────────────────────────────────────────
  Access token (shown once; store it now)
  Xq3...your-token...
  Config: ~/.config/opencode-scheduled-messages/config.json
  Lost it? Run with --rotate-token to issue a new one.
────────────────────────────────────────────────────────────────
```

打开 <http://127.0.0.1:8788>，粘贴令牌，选会话，写一句话，选“今晚 23:30”，提交。到点消息会追加到该会话。

### 手机（同一 Wi-Fi）

```bash
ocsched --lan
# LAN  http://192.168.x.x:8788
```

HTTP 能用，但 Service Worker / 安装到主屏需要 HTTPS。

### Tailscale（推荐）

```bash
tailscale serve --bg --https=443  http://127.0.0.1:8788
tailscale serve --bg --https=8443 http://127.0.0.1:4096
```

然后在 **设置 → OpenCode 原生界面地址** 填 `https://<host>.<tailnet>.ts.net:8443`。PWA 可安装，“完整会话”会打开真正的 OpenCode UI。

### Cloudflare Tunnel / nginx

两个域名分别指向 `8788`（本应用）和 `4096`（OpenCode 原生 UI），在设置里填第二个。记得关闭代理缓冲（nginx：`proxy_buffering off;`），否则 SSE 会被攒住。

### systemd

```bash
ocsched service print > ~/.config/systemd/user/ocsched.service
systemctl --user daemon-reload
systemctl --user enable --now ocsched
journalctl --user -u ocsched -f
```

生成的 unit 默认绑 `127.0.0.1`，并限制 `MemoryHigh=192M / MemoryMax=320M`，避免和 OpenCode 抢整机内存。

## 工作方式

1. 网关从 `~/.config/opencode/service.json`（或 `OPENCODE_PASSWORD`）读取密码，**在服务端**注入 Basic 认证，浏览器永远拿不到。
2. PWA 通过网关列会话。选一个会话后，把 `{sessionID, text, dueAt, timezone, policies}` 写进 SQLite。
3. 10 秒 tick 用原子 `UPDATE ... WHERE state='pending'` 领取到期任务。
4. 到点先检查 OpenCode 健康、会话存在、是否运行，再 `POST /api/session/{id}/prompt`，带稳定的 `msg_` id。
5. 重试复用同一个 id。OpenCode 对重复 id 返回原消息，不会发两遍。
6. 结果通过 SSE 推回页面（`schedule.accepted` / `schedule.failed`）。

### 状态机

```
pending ──► sending ──► accepted（已发送）
                                  └── done（预留）
   │           │
   │           ├──► pending   （临时错误，同 msg id 重试）
   │           ├──► missed    （超宽限 / 一直忙）
   │           └──► failed    （永久 4xx）
   ├──► waiting ──► sending   （会话当时在忙）
   └──► cancelled
```

`200 OK` 只代表 OpenCode 接受进 inbox，不代表模型跑完；UI 标为“已发送”（0.1 的终态）。真正的执行过程看原生会话或 SSE。OpenCode 离线时什么也没发，重试安全；若请求超时但服务端已接受，复用同一 id 会拿回原消息，不会重复。

## DeepSeek 峰谷：先讲清楚

DeepSeek 官方按量 API 在**谷时半价**。峰时是 **UTC 01:00–04:00 与 06:00–10:00，周一至周五**（不含中国法定节假日）；换成北京时间是**工作日 09:00–12:00、14:00–18:00**，其余时段、午休、周末、节假日都是谷时。

来源：<https://api-docs.deepseek.com/quick_start/pricing>

如果你用 **opencode-go** 订阅：月费不变，但额度按月美元金额计算，而 DeepSeek 峰时单价正好是谷时的 2 倍。所以谷时发送只消耗**一半额度**——经常撞 5 小时/周限额时等于可用量翻倍；从不撞限额时，收益是 0。UI 写的是“谷时 · 半额消耗”，不是“省一半钱”。

## 对比

| | **本项目** | opencode-scheduler | opencode-manager |
|---|---|---|---|
| 追加到**已有**会话 | ✅ | ❌（每次新会话） | ❌（每次新会话） |
| 持久队列 + 错过策略 | ✅ SQLite + 宽限 | ⚠️ 依赖 OS 调度，实际无重试 | ⚠️ DB job，cron 模式不补跑 |
| 移动端 UI | ✅ PWA + 原生深链 | ❌ | ✅ Web |
| 资源占用 | ~100 MB RSS，0 依赖，~150 KB 包 | 插件 + OS 定时器 | Bun + React + Docker，≥1.5 GB 镜像 |
| 无人值守权限控制 | ✅ 每条任务可配 | ⚠️ 直接拒绝 question | ❌ |

差异点不是“功能更多”，而是补上缺失的原语：**向已存在的线程延时追加一句话**。

## 安全模型

- 默认只绑 `127.0.0.1`；`--lan` 是显式动作。
- 访问令牌只打印一次，配置里存 SHA-256；浏览器拿签名 `HttpOnly; SameSite=Strict` cookie。
- 写操作校验 `Origin`；登录限速。
- OpenCode 密码只存在于网关进程，不写 HTML、不下发浏览器。
- CSP `default-src 'self'`，无内联脚本；所有消息文本先转义。
- 配置与数据库 `0600`，数据库放 `~/.local/share/`，不放 `/tmp`。
- 无人值守权限默认**等待**，不自动批准 shell/edit；自动放行需每条任务显式选择并标红警告。

详见 [`SECURITY.md`](SECURITY.md)。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `OPENCODE_BASE_URL` | 从 `service.json` 推导 | OpenCode HTTP API |
| `OPENCODE_PASSWORD` | 从 `service.json` 读取 | Basic 密码；优先用文件 |
| `OCSM_TOKEN` | 自动生成 | 固定访问令牌（容器/测试） |
| `OCSM_CONFIG_DIR` | `~/.config/opencode-scheduled-messages` | 配置目录 |
| `OCSM_DATA_DIR` | `~/.local/share/opencode-scheduled-messages` | SQLite 目录 |

CLI：`--port`、`--bind`、`--lan`、`--public-url`、`--opencode-url`、`--opencode-public-url`、`--rotate-token`、`--log-level`。

`--rotate-token` 只轮换并退出；需要 `systemctl --user restart ocsched` 才会生效。轮换会同时使现有浏览器会话失效。

## API

```
GET    /api/sessions
GET    /api/sessions/:id/messages
POST   /api/sessions/:id/send
GET    /api/sessions/:id/deep-link
GET    /api/schedules
POST   /api/schedules
PATCH  /api/schedules/:id
DELETE /api/schedules/:id
POST   /api/schedules/:id/send-now
POST   /api/schedules/:id/retry
GET    /api/events            (SSE)
```

详见 [`docs/API.md`](docs/API.md)。

## FAQ

### OpenCode 支持定时消息 / cron 吗？

V2.1 原生不支持。它有 durable inbox（`delivery: queue`），但没有定时器：队列项不会自己醒。这个项目补的就是定时器，并把它放在 OpenCode 进程之外持久化。

### 能给已有 OpenCode 会话发 prompt 吗？

可以，这是核心操作：`POST /api/session/{sessionID}/prompt`。

### 到点时电脑关机了怎么办？

任务保持 `pending`，OpenCode 不可达就重试。重启后只在 120 分钟宽限内补发；超过就标 `missed`，让你手动“重发”，避免半夜的想法中午突然发出去。

### 会话正忙怎么办？

默认等空闲，每 30 秒复查，最多 30 分钟，超时标 `missed`。也可以每条任务选“插入当前轮”或“跳过”。

### 是插件吗？要改 OpenCode 吗？

不是，也不用改。V2 插件不能注册 HTTP 路由，也没有持久定时器 API，所以可靠做法是独立进程走公开 API。

### 手机能用吗？

能。`--lan` 快速用；Tailscale/Cloudflare 提供 HTTPS 后可安装 PWA。会话页是紧凑速览，“完整会话”交给 OpenCode 自己的移动端 UI。

### 支持重复任务吗？

0.1 只做一次性。数据模型留了扩展空间，但刻意先不做 cron：这个场景是“今晚这句话”，不是“持续烧 token 的定时任务”。

## 限制

- 单用户、单 OpenCode 实例；没有多租户。
- OpenCode V2 API 标注 experimental；升级后跑一次 `ocsched doctor`。
- 紧凑会话页不是完整 Markdown/diff 渲染器；工具输出、diff、图片请走原生深链。
- 暂无推送通知；靠 PWA 角标和队列状态。
- 自动批准权限本身有风险；默认等待。

## 开发

```bash
git clone https://github.com/EaveBounty/opencode-scheduled-messages.git
cd opencode-scheduled-messages
npm test          # 39 个测试，无网络、无依赖
node bin/ocsched.js --help
```

源码：`src/store.js`（SQLite）、`src/scheduler.js`（状态机）、`src/http.js`（网关）、`src/opencode.js`（API 客户端）、`public/`（PWA）。

## 许可证

[PolyForm Noncommercial 1.0.0](LICENSE)。商业使用需单独授权；请开 issue 联系。
