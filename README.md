# magpie-agent-Tianshu-harness

把 [天枢](https://github.com/huiliyi37/Tianshu-harness)（Tianshu / rivet harness）作为一个 Agent 接进 [magpie](https://usemagpie.ai)：在 magpie 的 **Agents** 页给天枢选一个模型，天枢就通过 magpie 的网关用它全部供应商与路由组。

本仓库是 MathDD/magpie-agent-tianshu 的重构版：同样的接入思路，按 magpie 当前插件规范（`usemagpie.ai/docs/zh/plugins`）和天枢真实的配置 schema 重写。

## 为什么重写

| 问题 | 旧版 | 本版 |
|---|---|---|
| **图标** | 一张与天枢无关的四芒星图片，在 magpie 的 Agent 列表里认不出来 | 天枢官方应用图标 `app-icon.svg`（`Tianshu-harness/docs/brand/assets/`），内联为 `data:image/svg+xml`，离线可用 |
| **模型能力** | 只写 `contextWindow` / `maxTokens` / `supportsVision` | 另把推理档位（`capabilities.effortLevels` + `effortCap`）与价格（`pricing`，每百万 token）一起写进去 |
| **价格单位** | 未处理 | magpie 按 **每 token** 报价，天枢按 **每百万 token** 记账，已换算 |
| **未知值** | 0 会照写 | 0 与非整数视为「不知道」，直接不写，让天枢按模型 id 自行推断 |
| **旧模型** | 无处理 | 标记 `deprecated` |
| **思考内容** | 未声明 `reasoningSplit`，`reasoning_content` 里的思考被丢弃 | 声明 `reasoningSplit`，实测 3 个上游全部 200 |
| **检测** | 只看 `bin` | `bin` + `aliases: ["rivet"]`（同名入口的第二个命令），不靠配置目录判断是否安装 |
| **名称** | `Tianshu` | `天枢 Tianshu`，中文界面下直接显示中文名 |

## 安装

```bash
# 本地目录（开发时最省事：改完源码只要开关一次插件）
magpie plugin add /path/to/this/folder

# 或从 git
magpie plugin add github:LUMOGRESS/magpie-agent-Tianshu-harness
```

装上之后打开 magpie → **Agents**，天枢这一行出现了。在此之前先确认天枢已装：

```bash
tianshu --version    # tianshu-harness 把 tianshu / rivet 放到 PATH
```

**如果之前装过旧版**，两者用的是同一个 agent id `tianshu`，magpie 只会让其中一个提供它。先移除旧的：

```bash
magpie plugin rm magpie-agent-tianshu     # 或按插件列表里那一行的名字
magpie plugin add /path/to/this/folder
```

## 用法

在 Agents 页天枢那一行选一个 magpie 模型，或：

```bash
magpie models tianshu          # magpie 为天枢列出的模型
magpie tianshu zcode/GLM-5.3-Flash
magpie tianshu default         # 取消接入，把天枢原来的配置还回去
```

天枢在**新会话**读取配置：重启天枢，或新开一个会话。

## 它写了什么

只写 `~/.rivet/config.json` 里的两个键，其余内容（其他供应商、`mcp.servers`、主题设置…）原样保留：

```json
{
  "provider": {
    "default": "magpie",
    "providers": {
      "magpie": {
        "name": "magpie",
        "baseUrl": "http://127.0.0.1:3425/v1",
        "protocol": "openai",
        "apiKey": "<magpie 为这个 Agent 生成的网关密钥>",
        "models": [
          {
            "id": "auto/gpt-6.1-terra",
            "contextWindow": 922000,
            "maxTokens": 128000,
            "supportsVision": true,
            "pricing": { "input": 1, "output": 5, "cacheRead": 0.05, "cacheWrite": 1.25 },
            "capabilities": {
              "effortFormat": "reasoning_effort",
              "effortLevels": ["none", "low", "medium", "high", "xhigh", "max", "ultra"]
            }
          }
        ]
      }
    }
  },
  "agent": { "defaultModel": "magpie:auto/gpt-6.1-terra" }
}
```

`agent.defaultModel` 由 magpie 自己写入（键名由 `magpie.agent.model` 指定，模型 id 前面加 `magpie:` 由 `prefix` 决定）。网关地址、密钥、模型清单、上限、能力都由 `connect()` 提供，magpie 的模型有变动时会再调一次。

模型清单是整份重写的：天枢里先前选过的模型也一定是 magpie 的模型，所以每次都按 magpie 当前提供的列表重新列。

## 边界

- **不写 MCP**：magpie 能写的 MCP 格式（`mcpFormat`）是一份固定白名单，天枢不在其中 —— 天枢的服务器在 `~/.rivet/config.json` 的 `mcp.servers` 里，形状是自己的。所以这里不声明 `library`，也不猜一个格式去写它。
- **不写 skills / instructions**：天枢的运行时只从 `.rivet/skills` 加载技能（源码原话：*the runtime only ever loads from .rivet/skills — external dirs are never loaded*），而 magpie 资源库写的是 `~/.agents/skills` 一类的外部目录。声明 `library.skills` 不会让天枢加载到它们，只会制造一个看起来生效、实际空转的配置。
- **只碰一个文件**：`~/.rivet/config.json`。天枢其余配置由天枢自己管。

## 与社区官方 agent 包的对照

`magpie-community/plugins` 里 20 个 agent 包逐字段看过一遍，本包与之对齐或有意不同的地方：

| 字段 | 社区用法 | 本包 | 依据 |
|---|---|---|---|
| `dir` | 19/20 都写 | `~/.rivet` | `agent-deepzora`（同为带桌面端的 harness）写 `~/.deepzora` |
| `bin` | 11/20 写 | `tianshu` | 与 `agent-kilo` 同构 |
| `aliases` | 少数包写 | `["rivet"]` | 天枢的第二个命令名 |
| `notice` | 全部 20 个都写 | 中英并列 | 措辞照 `agent-kilo`：先说行为，再说补救 |
| `config` 写在自己目录 | 9/20 这么做 | **不用** | 详见下 |
| `library` | 5/20 写 | **不写** | 详见下 |

**为什么不像 `agent-kimi-desktop` / `agent-nanobot` 那样把 config 指向 `~/.config/magpie-*/`**

那 9 个包能把配置写在自建文件里，是因为它们的 agent 接受一个配置文件路径参数（或环境变量）。天枢有 `RIVET_CONFIG_PATH`，实测有效：指向不存在的文件时，天枢会退回「API key 未设置」，证明确实读的是那个路径；用一个自建的 config 也能完整跑通（实测返回正常回答）。但设这个变量要从**启动方式**入手（`launch.env`），而 magpie 的 agent 插件只能写文件、不能设环境变量。天枢从 Windows 快捷方式或 `tianshu` 命令直接启动时，环境里没有这个变量，隔离文件就白写了。

所以这里写天枢真正读取的 `~/.rivet/config.json`，只碰两个键，其余原样。安全网是 magpie 自己的 `Unwire` 契约（`internal/agent/agent.go`）：第一次写入前把字段原值 stash 起来，关掉开关时还原。

**为什么仍然不写 `library`**

5 个写 `library` 的包，其 agent 都能从某个目录读技能、从某个 JSON 读 MCP 服务器。天枢两样都不同：

- 技能：rivet 的加载路径是固定写死的——源码注释原话 *the runtime only ever loads from .rivet/skills — external dirs are never scanned in place*，而且它自己的机制是「把 `.claude/skills` 里的技能**复制进** `.rivet/skills`」再加载。magpie 资源库往外部目录写，天枢不会去看。
- MCP：天枢的服务器在 `~/.rivet/config.json` 的 `mcp.servers` 下，形状是自己的；magpie 可写的 `mcpFormat` 白名单里没有这一种。

两样都声明了也不会生效，只会做出一个看起来接上、实际空转的配置。

## 测试

```bash
node --test tianshu.test.mjs
```

测试按天枢 `dist` 里 `modelConfigSchema` / `providerBaseSchema` 的字段集校验写出的每一条，防止写出会被 zod 静默丢弃的键。


## 让别人在 magpie 里看到它

magpie 的「发现」页有四个位置能露出插件，门槛依次提高。这个包是 **agent 插件**，下面每一步都只针对它。

### 1. GitHub 加 `magpie-plugin` topic —— 最快，几分钟生效

把仓库推到 GitHub，然后给它打 tag：

```bash
gh repo create magpie-agent-Tianshu-harness --public --source=. --push
gh repo edit --add-topic magpie-plugin
```

magpie 每十分钟查一次 GitHub，之后插件会出现在 **插件 → 发现 → 非官方插件 · GitHub**，按 Star 排序，并标明「没有人审阅过」。要求：

- `package.json` 在**仓库根目录**（本仓库就是）；
- 插件要加载的文件必须提交进仓库（`tianshu.agent.js` 已提交，没有构建步骤）；
- 卡片图标取 `package.json` 里的 `magpie.icon`（本包已内联）；
- `LICENSE` 必须是 GitHub 能识别的标准文本，否则卡片回退到 `package.json` 的 `license`。本包的 LICENSE 保持 MIT 原文，图标版权单独放在 `NOTICE`；
- fork、已归档的仓库、以及 `magpie-community/` 自己的仓库不会显示。

别人这样装：`magpie plugin add github:LUMOGRESS/magpie-agent-Tianshu-harness`。

### 2. 发到 npm —— 让「发现」页的搜索找得到

```bash
npm publish --access public
```

搜索规则（文档原文）：`插件里的搜索会向 npm 查询 <关键词> opencode，显示名字或 keywords 里同时含有 opencode 和 auth、plugin、provider 之一的包`。所以 keywords 里必须有 **`opencode`**，并且至少有一个 `auth` / `plugin` / `provider` 词——本包的 `["opencode", "opencode-plugin", …]` 满足这条，缺了就会被搜不到。

发 npm 后别人可以 `magpie plugin add magpie-agent-tianshu-harness`，详情页显示的是 npm 上的这份 README。

### 3. 进官方推荐列表 —— 需要 PR

**插件页的推荐位来自社区仓库的 `registry.json`**，magpie 最多每六小时拉一次。提 PR 到 `magpie-community/plugins`，加一条 agent 条目（agent 条目不写 `providers`）：

```json
{
  "package": "magpie-agent-tianshu-harness",
  "name": "天枢 Tianshu",
  "icon": "data:image/svg+xml;base64,…",
  "kind": "agent",
  "community": true,
  "summary": {
    "en": "Connect Tianshu (天枢 / rivet harness) to any Magpie model from Magpie's Agents page.",
    "zh": "在 magpie 的 Agents 页为天枢（Tianshu / rivet harness）选 magpie 的模型。"
  }
}
```

`package` 是 **npm 包名**——所以这条路要求先完成第 2 步。条目渲染可以用 `MAGPIE_PLUGIN_MARKET=<你的 registry.json 地址> magpie ...` 先自查，`MAGPIE_PLUGIN_MARKET=off` 则只用内置副本。

### 4. 收进 magpie-community —— 由社区维护、自动更新

把包放进 `magpie-community/plugins` 的 `packages/<name>`，按命名约定改成 `@magpie-community/agent-tianshu`，版本号推到 `main` 就自动发布，之后每个装了它的 magpie 会自动更新，不需要用户点「更新」。

## 许可

MIT。图标是 Tianshu（天枢）自己的应用图标，取自
Tianshu-harness 的
`docs/brand/assets/app-icon.svg`，逐字节内联，出处见 `NOTICE`。
