# agent-config-sync

一键同步与分发多 Agent 配置（Cursor / Claude Code / Codex / Qoder）的轻量级 CLI。
单一源头存放在 `.ai/`，由 `agentcs` 按编辑器约定分发；也支持反向导入与冲突保护。

## Install

推荐全局安装，这样安装后可直接使用 `agentcs`：

```bash
npm install -g @lyzz0612/agent-config-sync
```

如果只想临时执行，也可以直接使用：

```bash
npx agentcs <command>
```

## Quick start

```bash
agentcs init      # 选择启用哪些编辑器，初始化 .ai/ 与 VCS ignore
agentcs sync      # 把 .ai/ 同步到已检测到的编辑器目录
agentcs status    # 查看当前状态
agentcs check     # 校验 .ai/ 结构与 frontmatter
```

## 目录约定

```
project-root/
  .ai/
    rules/        # 通用规则（Markdown + YAML frontmatter）
    mcp.json      # MCP 服务配置
    skills/       # 技能定义
    agents/       # SubAgent 定义
    commands/     # 自定义命令 / 快捷指令
    hooks.json    # Hook 元数据
    hooks/        # Hook 脚本
```

启用哪些编辑器由项目根下是否存在以下目录推断：

| 目录 | 编辑器 |
|------|--------|
| `.cursor/` | Cursor |
| `.claude/` | Claude Code |
| `.codex/`  | Codex |
| `.qoder/`  | Qoder |

> `agent-config-sync` 不再使用 `.ai/config.json` 或 `.agents/`。
>
> 项目根会优先识别离当前目录最近、且包含 `.ai/`、编辑器目录，或常见项目文件（如
> `package.json`、`*.uproject`、`*.sln`）的目录；如果都找不到，才回退到向上查找
> `.git` / `.svn` / `.p4config`。

## Commands

| 命令 | 作用 |
|------|------|
| `agentcs init` | 创建/更新 `.ai/` 骨架；多选编辑器；更新 VCS ignore；幂等可重复执行 |
| `agentcs sync` | 把 `.ai/` 内容写入各编辑器目录 |
| `agentcs import` | 反向导入：从某个编辑器读取并合并 / 覆盖到 `.ai/` |
| `agentcs status` | 显示已启用编辑器、待写入 / 待更新 / 冲突 / `.ai/` 内容统计 |
| `agentcs check` | 校验 `.ai/` 结构、frontmatter 与 JSON 合法性 |

`agentcs sync` 选项：

- `-e, --editor <name>`：仅同步某个编辑器。
- `--dry-run`：仅展示计划，不写入。
- `--force`：覆盖未被本工具标记的冲突文件。

## 冲突策略

`agentcs` 写入的文件携带 `managed by agent-config-sync` 标记（HTML 注释 / 行注释 /
JSON 字段，因文件格式而异）。同步时：

- 目标不存在：写入；
- 目标存在且含标记：内容一致跳过，不一致更新；
- 目标存在但不含标记：视为人工文件，跳过并在汇总中报告。`--force` 可覆盖并加上标记。

## VCS ignore

`init` 与 `sync` 会从当前项目目录继续向上查找 `.git` / `.svn` / `.p4config`，并在找到的
ignore 文件中维护一段带边界注释的块，确保编辑器目录不被提交：

```gitignore
# >>> agent-config-sync (managed) >>>
# AI editor configs (managed by agent-config-sync)
.cursor/
.claude/
.codex/
.qoder/
.mcp.json
# <<< agent-config-sync (managed) <<<
```

`.ai/` 本身不会被 ignore——它是源头，需要随仓库一起提交。

## 退出码

| 退出码 | 含义 |
|--------|------|
| `0` | 成功 |
| `1` | 缺少 `.ai/` 或参数错误等可恢复问题 |
| `2` | `sync` / `status` 检出冲突文件且未启用 `--force` |

## 开发

```bash
npm install
npm run build
npm test
```

## 发布

`publish.yml` 使用 npm Trusted Publishing，不再依赖 `NPM_TOKEN`。首次启用前，需要在 npm 包页面或包创建流程里把当前 GitHub 仓库配置为 trusted publisher。

注意：如果 `@lyzz0612/agent-config-sync` 还没有在 npm 上创建包页面，通常需要先完成一次首次发布/建包，之后才能在 npm 后台绑定 Trusted Publisher。

建议配置：

- npm package: `@lyzz0612/agent-config-sync`
- provider: `GitHub Actions`
- repository: `lyzz0612/agent-config-sync`
- workflow file: `.github/workflows/publish.yml`
- environment: 留空（当前 workflow 未使用 GitHub Environment）

完成绑定后，推送形如 `v0.1.0` 的 tag 会触发：

```bash
npm ci
npm run build
npm test
npm publish --provenance --access public
```

如果此前配置过 `NPM_TOKEN`，可以删除对应的 GitHub Actions secret，避免和 Trusted Publishing 混用。

## License

MIT
