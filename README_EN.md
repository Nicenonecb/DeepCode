# DeepCode

[![GitHub Stars](https://img.shields.io/github/stars/Nicenonecb/DeepCode?style=flat-square&logo=github&color=yellow)](https://github.com/Nicenonecb/DeepCode/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/Nicenonecb/DeepCode?style=flat-square&color=orange)](https://github.com/Nicenonecb/DeepCode/issues)
[![Last Commit](https://img.shields.io/github/last-commit/Nicenonecb/DeepCode?style=flat-square&color=blue)](https://github.com/Nicenonecb/DeepCode/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)

DeepCode is a terminal coding assistant project focused on DeepSeek V4 Pro and OpenAI-compatible model providers. It keeps the productive local workflow people expect from modern coding agents: repository understanding, file edits, command execution, patch generation, debugging, and scriptable terminal usage.

The codebase started from a terminal coding agent foundation and is being refit around DeepCode's own product direction: local-first usage, API key based provider configuration, and a cleaner public identity.

## Highlights

- Terminal REPL, pipe mode, and scriptable CLI entry points
- File read/write, search, shell execution, and tool orchestration
- DeepSeek V4 Pro workflow via OpenAI-compatible Chat Completions endpoints
- Bun runtime, TypeScript strict mode, React/Ink terminal UI
- Feature-flagged architecture for experimental capabilities

## Quick Start

Install Bun 1.3.0 or newer:

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
```

Install dependencies:

```bash
cd DeepCode
bun install
```

Configure an OpenAI-compatible provider:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://your-deepseek-endpoint/v1"
export OPENAI_MODEL="deepseek-v4-pro"
```

Start the development CLI:

```bash
bun run dev
```

Use pipe mode:

```bash
echo "Explain this repository entry point" | bun run src/entrypoints/cli.tsx -p
```

## Common Commands

```bash
bun run dev          # local development mode
bun run build        # build dist output
bun run typecheck    # TypeScript check
bun test             # run tests
bun run lint         # Biome lint
bun run format       # format source files
```

## Repository

- Source: [github.com/Nicenonecb/DeepCode](https://github.com/Nicenonecb/DeepCode)
- Runtime: Bun
- Language: TypeScript / TSX
- UI: React + Ink

## Notice

DeepCode is an independent research and engineering project. Some compatibility names remain in code where they are part of external APIs, SDKs, environment variables, or upstream protocol behavior.
