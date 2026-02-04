# Multi-Agent Manager

VS Code拡張機能で、Claude Code CLIとGemini CLIのエージェントを管理します。

## 機能

- Claude Code CLIを使用したタスク実行
- Gemini CLIを使用したタスク実行
- チャットインターフェースでの対話
- タスクの進行状況表示と管理

## インストール

### 前提条件

- VS Code 1.90.0以上
- Claude Code CLI（[インストール方法](https://docs.anthropic.com/claude/docs/desktop-setup)）
- Gemini CLI（GoogleのGemini CLIをインストール）

### 拡張機能のインストール

1. このリポジトリをクローンまたはダウンロード。
2. `npm install` を実行。
3. `npm run compile` でビルド。
4. `vsce package` でVSIXファイルを作成。
5. VS Codeで「Install from VSIX」を選択してインストール。

または、VS Code Marketplaceからインストール（公開後）。

## 使用方法

1. VS Codeでチャットを開く（Ctrl+Shift+P → "Chat: Open Chat"）。
2. `@claude [プロンプト]` でClaudeエージェントを使用。
3. `@gemini [プロンプト]` でGeminiエージェントを使用。

### 設定

- `multiAgent.claudePath`: Claude CLIのパス（デフォルト: "claude"）
- `multiAgent.geminiPath`: Gemini CLIのパス（デフォルト: "gemini"）
- `multiAgent.maxConcurrentTasks`: 最大同時実行タスク数（デフォルト: 5）

## セキュリティ注意

CLIツールのパスはユーザーが設定可能ですが、信頼できるパスを使用してください。悪意ある実行を避けるため、公式のCLIツールを使用することを推奨します。

## ライセンス

MIT License

## 貢献

プルリクエストやイシューを歓迎します。