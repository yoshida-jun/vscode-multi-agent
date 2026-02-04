import * as vscode from 'vscode';
import { TaskManager } from '../executors/TaskManager';

export class InputPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'multiAgent.inputPanel';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly taskManager: TaskManager
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage((data) => {
            switch (data.type) {
                case 'runClaude':
                    this._runTask('claude', data.prompt);
                    break;
                case 'runGemini':
                    this._runTask('gemini', data.prompt);
                    break;
                case 'runBoth':
                    this._runBoth(data.prompt);
                    break;
                case 'copy':
                    vscode.env.clipboard.writeText(data.text);
                    vscode.window.showInformationMessage('Copied to clipboard!');
                    break;
            }
        });
    }

    private async _runTask(agent: 'claude' | 'gemini', prompt: string) {
        if (!prompt.trim()) {
            vscode.window.showWarningMessage('Please enter a prompt');
            this._notifyTaskCreated();
            return;
        }

        const task = this.taskManager.createTask(agent, prompt);
        this._notifyTaskCreated();

        // Execute and send result to webview
        this.taskManager.executeTask(task.id)
            .then(output => {
                this._sendOutput(agent, output);
            })
            .catch(error => {
                this._sendError(agent, error.message);
            });
    }

    private async _runBoth(prompt: string) {
        if (!prompt.trim()) {
            vscode.window.showWarningMessage('Please enter a prompt');
            this._notifyTaskCreated();
            return;
        }

        const claudeTask = this.taskManager.createTask('claude', prompt);
        const geminiTask = this.taskManager.createTask('gemini', prompt);
        this._notifyTaskCreated();

        // Execute both and show the first to complete
        this.taskManager.executeTask(claudeTask.id)
            .then(output => this._sendOutput('claude', output))
            .catch(error => this._sendError('claude', error.message));

        this.taskManager.executeTask(geminiTask.id)
            .then(output => this._sendOutput('gemini', output))
            .catch(error => this._sendError('gemini', error.message));
    }

    private _notifyTaskCreated(): void {
        this._view?.webview.postMessage({ type: 'taskCreated' });
    }

    private _sendOutput(agent: string, output: string): void {
        this._view?.webview.postMessage({ type: 'taskOutput', agent, output });
    }

    private _sendError(agent: string, error: string): void {
        this._view?.webview.postMessage({ type: 'taskError', agent, error });
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            padding: 8px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
        }
        textarea {
            width: 100%;
            min-height: 80px;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            resize: vertical;
            font-family: inherit;
            font-size: 13px;
            box-sizing: border-box;
        }
        textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .controls {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .radio-option {
            display: flex;
            align-items: center;
            gap: 2px;
            cursor: pointer;
        }
        .radio-option input[type="radio"] {
            accent-color: var(--vscode-focusBorder);
            cursor: pointer;
            margin: 0;
        }
        .radio-option label {
            cursor: pointer;
            font-size: 11px;
        }
        .label-claude { color: #A78BFA; }
        .label-gemini { color: #60A5FA; }
        .label-both { color: #34D399; }
        button {
            padding: 4px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .output-section {
            margin-top: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 8px;
        }
        .output-header {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .output-content {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            font-size: 12px;
            max-height: 300px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .output-content.empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .output-content.loading {
            color: var(--vscode-descriptionForeground);
        }
        .copy-btn {
            padding: 2px 6px;
            font-size: 10px;
            margin-left: 0;
        }
        .agent-badge {
            display: inline-block;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 10px;
            margin-right: 4px;
        }
        .badge-claude { background: #6B46C1; color: white; }
        .badge-gemini { background: #4285F4; color: white; }
        .output-item {
            margin-bottom: 4px;
        }
        .output-text {
            margin-bottom: 12px;
            padding-left: 4px;
            border-left: 2px solid var(--vscode-panel-border);
        }
        .output-text:last-child {
            margin-bottom: 0;
        }
    </style>
</head>
<body>
    <textarea id="prompt" placeholder="Enter prompt... (Enter=send, Shift+Enter=newline)"></textarea>
    <div class="controls">
        <div class="radio-option">
            <input type="radio" id="agent-claude" name="agent" value="claude" checked>
            <label for="agent-claude" class="label-claude">Claude</label>
        </div>
        <div class="radio-option">
            <input type="radio" id="agent-gemini" name="agent" value="gemini">
            <label for="agent-gemini" class="label-gemini">Gemini</label>
        </div>
        <div class="radio-option">
            <input type="radio" id="agent-both" name="agent" value="both">
            <label for="agent-both" class="label-both">Both</label>
        </div>
        <button type="button" id="sendBtn">Send</button>
    </div>
    <div class="output-section">
        <div class="output-header">
            <span id="outputLabel">Output</span>
            <button type="button" id="copyBtn" class="copy-btn" style="display:none;">Copy</button>
        </div>
        <div id="output" class="output-content empty">No output yet</div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const textarea = document.getElementById('prompt');
        const sendBtn = document.getElementById('sendBtn');
        const outputDiv = document.getElementById('output');
        const outputLabel = document.getElementById('outputLabel');
        const copyBtn = document.getElementById('copyBtn');
        let outputs = {}; // Store outputs by agent
        let currentMode = 'claude';

        function getSelectedAgent() {
            return document.querySelector('input[name="agent"]:checked').value;
        }

        function setEnabled(enabled) {
            textarea.disabled = !enabled;
            sendBtn.disabled = !enabled;
            sendBtn.textContent = enabled ? 'Send' : 'Sending...';
            if (enabled) textarea.focus();
        }

        function renderOutputs() {
            const agents = Object.keys(outputs);
            if (agents.length === 0) {
                outputDiv.innerHTML = '<span class="empty">No output yet</span>';
                outputDiv.className = 'output-content empty';
                copyBtn.style.display = 'none';
                return;
            }

            let html = '';
            for (const agent of agents) {
                const data = outputs[agent];
                const badge = '<span class="agent-badge badge-' + agent + '">' + agent + '</span>';
                const status = data.loading ? ' (running...)' : '';
                html += '<div class="output-item">' + badge + status + '</div>';
                html += '<div class="output-text">' + escapeHtml(data.content) + '</div>';
            }
            outputDiv.innerHTML = html;
            outputDiv.className = 'output-content';

            const hasContent = agents.some(a => !outputs[a].loading && outputs[a].content);
            copyBtn.style.display = hasContent ? 'inline-block' : 'none';
            outputLabel.textContent = agents.some(a => outputs[a].loading) ? 'Running...' : 'Output';
        }

        function setOutput(agent, content, isLoading) {
            outputs[agent] = { content, loading: isLoading };
            renderOutputs();
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function send() {
            const prompt = textarea.value.trim();
            if (!prompt) return;

            setEnabled(false);
            outputs = {}; // Clear previous outputs
            currentMode = getSelectedAgent();

            if (currentMode === 'claude') {
                setOutput('claude', 'Waiting...', true);
                vscode.postMessage({ type: 'runClaude', prompt });
            } else if (currentMode === 'gemini') {
                setOutput('gemini', 'Waiting...', true);
                vscode.postMessage({ type: 'runGemini', prompt });
            } else {
                setOutput('claude', 'Waiting...', true);
                setOutput('gemini', 'Waiting...', true);
                vscode.postMessage({ type: 'runBoth', prompt });
            }
        }

        // Listen for messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.type) {
                case 'taskCreated':
                    setEnabled(true);
                    // Don't clear input - let user keep it
                    break;
                case 'taskOutput':
                    setOutput(message.agent, message.output, false);
                    break;
                case 'taskError':
                    setOutput(message.agent, 'Error: ' + message.error, false);
                    break;
            }
        });

        copyBtn.addEventListener('click', () => {
            const allOutputs = Object.entries(outputs)
                .filter(([_, data]) => !data.loading)
                .map(([agent, data]) => '[' + agent + ']\\n' + data.content)
                .join('\\n\\n');
            vscode.postMessage({ type: 'copy', text: allOutputs });
        });

        sendBtn.addEventListener('click', send);

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !textarea.disabled) {
                e.preventDefault();
                send();
            }
        });

        textarea.focus();
    </script>
</body>
</html>`;
    }
}
