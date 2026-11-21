# magpie-agent-tianshu

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
| **检测** | 只看 `bin` | `bin` + `aliases: ["rivet"]`（同名入口的第二个命令），不靠配置目录判断是否安装 |
| **名称** | `Tianshu` | `天枢 Tianshu`，中文界面下直接显示中文名 |

## 安装

```bash
# 本地目录（开发时最省事：改完源码只要开关一次插件）
magpie plugin add /path/to/this/folder

# 或从 git
magpie plugin add github:<你的仓库>/magpie-agent-tianshu
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

- **不写 MCP**：magpie 能写的 MCP 格式里没有天枢那种（天枢的服务器在 `~/.rivet/config.json` 的 `mcp.servers` 里，形状是自己的），所以这里不声明 `library`，也不猜一个格式去写它。
- **不写 skills / instructions**：天枢的全局技能目录是 `~/.agents/skills` 与 `~/.rivet/skills`，其中前者已经是 magpie 资源库自己的来源，写进去会让同一个技能被登记两次。
- **只碰一个文件**：`~/.rivet/config.json`。天枢其余配置由天枢自己管。

## 测试

```bash
node --test tianshu.test.mjs
```

测试按天枢 `dist` 里 `modelConfigSchema` / `providerBaseSchema` 的字段集校验写出的每一条，防止写出会被 zod 静默丢弃的键。

## 许可

MIT
