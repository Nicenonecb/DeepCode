# DeepCode

DeepCode 是一个面向 **DeepSeek V4 Pro** 模型的终端编程助手项目，目标是在本地提供类似 Claude Code 的交互式编码体验：理解项目、读写文件、运行命令、修复错误、生成补丁，并围绕真实代码仓库完成开发任务。

本项目基于 reverse-engineered / decompiled 的 Claude Code CLI 工程继续整理和适配，重点服务于 DeepSeek V4 Pro 这类强代码模型的日常开发工作流。

## 项目定位

- 为 DeepSeek V4 Pro 提供本地代码执行与项目理解入口
- 支持终端 REPL 交互、pipe 模式和脚本化调用
- 支持文件读写、搜索、命令执行、工具调用和多 provider 配置
- 适合用于个人开发、项目维护、代码阅读、重构和调试

## 技术栈

- 语言：TypeScript / TSX
- 运行时：Bun
- 终端 UI：React + Ink
- CLI 框架：Commander.js
- 测试：bun:test
- 格式化与检查：Biome + TypeScript strict mode

## 快速开始

### 1. 安装 Bun

需要 Bun 1.3.0 或更高版本。

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

### 2. 安装依赖

```bash
cd /Users/justin/Desktop/DeepCode
bun install
```

### 3. 配置 DeepSeek V4 Pro

如果你的 DeepSeek V4 Pro 服务提供 OpenAI Chat Completions 兼容接口，可以使用下面的环境变量启动：

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY="你的 API Key"
export OPENAI_BASE_URL="https://你的-deepseek-api-endpoint/v1"
export OPENAI_MODEL="deepseek-v4-pro"
```

如果服务商实际模型 ID 不是 `deepseek-v4-pro`，请替换成控制台里显示的模型名称。

也可以启动后使用 `/login` 在交互界面里配置模型和接口地址。

### 4. 启动开发模式

```bash
bun run dev
```

### 5. Pipe 模式

```bash
echo "帮我解释这个项目的入口文件" | bun run src/entrypoints/cli.tsx -p
```

## 常用命令

```bash
bun run dev          # 本地开发模式
bun run build        # 构建产物
bun run typecheck    # TypeScript 类型检查
bun test             # 运行测试
bun run lint         # Biome lint
bun run format       # 格式化 src/
bun run test:all     # 完整检查
```

## 目录说明

```text
src/                         主 CLI、REPL、API、状态管理与运行时逻辑
packages/builtin-tools/      内置工具实现
packages/@ant/ink/           终端 UI 渲染框架
packages/remote-control-server/ 远程控制服务
docs/                        项目文档
scripts/                     构建、开发、检查脚本
```

## 开发约定

- 修改后优先运行 `bun run typecheck`
- 提交前尽量运行 `bun run test:all`
- 新功能遵循现有 feature flag 机制
- 生产代码避免使用 `as any`
- 保持 TypeScript strict mode 零错误

## 许可证与声明

本项目仅用于学习、研究和个人实验。原 Claude Code 的相关权利归 Anthropic 所有。

如果你要公开分发、商用、重新发布 npm 包或进行大规模二次开发，请先确认相关版权、商标和许可证风险。
