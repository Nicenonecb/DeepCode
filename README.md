# DeepCode

DeepCode 是一个面向 **DeepSeek V4 Pro** 模型终端编程助手，目标是在本地提供ClaudeCode的交互式编码体验：理解项目、读写文件、运行命令、修复错误、生成补丁，并围绕真实代码仓库完成开发任务。且能发挥100% DeepSeek V4 Pro的能力，提供更准确的代码理解和生成结果。

本项目重点服务于 DeepSeek系列模型的日常开发工作流。


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
cd DeepCode
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
