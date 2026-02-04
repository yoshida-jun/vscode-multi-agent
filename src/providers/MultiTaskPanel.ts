import * as vscode from 'vscode';
import { TaskManager } from '../executors/TaskManager';
import { ClaudeParticipant } from '../participants/claudeParticipant';
import { GeminiParticipant } from '../participants/geminiParticipant';

export class MultiTaskPanel {
    public static currentPanel: MultiTaskPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private taskManager: TaskManager,
        private claudeParticipant: ClaudeParticipant,
        private geminiParticipant: GeminiParticipant
    ) {
        this._panel = panel;
        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'runTask':
                        await this._runTask(message.agent, message.prompt);
                        break;
                    case 'runParallel':
                        await this._runParallel(message.prompt);
                        break;
                    case 'runBatch':
                        await this._runBatch(message.tasks);
                        break;
                    case 'cancelTask':
                        this.taskManager.cancelTask(message.taskId);
                        this._updateTaskList();
                        break;
                    case 'refresh':
                        this._updateTaskList();
                        break;
                }
            },
            null,
            this._disposables
        );

        // Update task list when tasks change
        this.taskManager.onTasksChanged(() => {
            this._updateTaskList();
        });
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        taskManager: TaskManager,
        claudeParticipant: ClaudeParticipant,
        geminiParticipant: GeminiParticipant
    ) {
        const column = vscode.ViewColumn.Two;

        if (MultiTaskPanel.currentPanel) {
            MultiTaskPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'multiTaskPanel',
            'Multi-Agent Task Panel',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        MultiTaskPanel.currentPanel = new MultiTaskPanel(
            panel,
            extensionUri,
            taskManager,
            claudeParticipant,
            geminiParticipant
        );
    }

    private async _runTask(agent: 'claude' | 'gemini', prompt: string) {
        if (agent === 'claude') {
            await this.claudeParticipant.executeTask(prompt);
        } else {
            await this.geminiParticipant.executeTask(prompt);
        }
    }

    private async _runParallel(prompt: string) {
        const claudePromise = this.claudeParticipant.executeTask(prompt);
        const geminiPromise = this.geminiParticipant.executeTask(prompt);
        await Promise.allSettled([claudePromise, geminiPromise]);
    }

    private async _runBatch(tasks: Array<{ agent: 'claude' | 'gemini'; prompt: string }>) {
        const promises = tasks.map(task => this._runTask(task.agent, task.prompt));
        await Promise.allSettled(promises);
    }

    private _updateTaskList() {
        const tasks = this.taskManager.getAllTasks().map(task => ({
            id: task.id,
            agent: task.agent,
            prompt: task.prompt.substring(0, 50),
            status: task.status,
            progress: task.progress
        }));

        this._panel.webview.postMessage({
            command: 'updateTasks',
            tasks
        });
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Multi-Agent Task Panel</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .section {
            margin-bottom: 24px;
            padding: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        h2 {
            margin-top: 0;
            color: var(--vscode-titleBar-activeForeground);
        }
        .input-group {
            margin-bottom: 12px;
        }
        label {
            display: block;
            margin-bottom: 4px;
            font-weight: bold;
        }
        input, textarea, select {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        textarea {
            min-height: 80px;
            resize: vertical;
        }
        button {
            padding: 8px 16px;
            margin-right: 8px;
            margin-top: 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-parallel {
            background: #4CAF50;
            color: white;
        }
        .btn-danger {
            background: #f44336;
            color: white;
        }
        .task-list {
            max-height: 300px;
            overflow-y: auto;
        }
        .task-item {
            display: flex;
            align-items: center;
            padding: 8px;
            margin-bottom: 8px;
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }
        .task-agent {
            font-weight: bold;
            margin-right: 8px;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .task-agent.claude {
            background: #6B46C1;
            color: white;
        }
        .task-agent.gemini {
            background: #4285F4;
            color: white;
        }
        .task-prompt {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .task-status {
            margin-left: 8px;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        .task-status.running {
            background: #2196F3;
            color: white;
        }
        .task-status.completed {
            background: #4CAF50;
            color: white;
        }
        .task-status.failed {
            background: #f44336;
            color: white;
        }
        .batch-item {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
        }
        .batch-item select {
            width: 120px;
        }
        .batch-item input {
            flex: 1;
        }
        .batch-item button {
            margin: 0;
        }
    </style>
</head>
<body>
    <h1>Multi-Agent Task Panel</h1>

    <div class="section">
        <h2>Quick Run</h2>
        <div class="input-group">
            <label for="quick-prompt">Prompt:</label>
            <textarea id="quick-prompt" placeholder="Enter your prompt here..."></textarea>
        </div>
        <button class="btn-primary" onclick="runClaude()">Run Claude</button>
        <button class="btn-primary" onclick="runGemini()">Run Gemini</button>
        <button class="btn-parallel" onclick="runParallel()">Run Both (Parallel)</button>
    </div>

    <div class="section">
        <h2>Batch Tasks</h2>
        <div id="batch-tasks">
            <div class="batch-item">
                <select class="batch-agent">
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                </select>
                <input type="text" class="batch-prompt" placeholder="Task prompt...">
                <button class="btn-danger" onclick="removeBatchItem(this)">-</button>
            </div>
        </div>
        <button class="btn-primary" onclick="addBatchItem()">+ Add Task</button>
        <button class="btn-parallel" onclick="runBatch()">Run All Batch Tasks</button>
    </div>

    <div class="section">
        <h2>Running Tasks</h2>
        <button class="btn-primary" onclick="refresh()">Refresh</button>
        <div id="task-list" class="task-list"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function runClaude() {
            const prompt = document.getElementById('quick-prompt').value;
            if (!prompt) return alert('Please enter a prompt');
            vscode.postMessage({ command: 'runTask', agent: 'claude', prompt });
        }

        function runGemini() {
            const prompt = document.getElementById('quick-prompt').value;
            if (!prompt) return alert('Please enter a prompt');
            vscode.postMessage({ command: 'runTask', agent: 'gemini', prompt });
        }

        function runParallel() {
            const prompt = document.getElementById('quick-prompt').value;
            if (!prompt) return alert('Please enter a prompt');
            vscode.postMessage({ command: 'runParallel', prompt });
        }

        function addBatchItem() {
            const container = document.getElementById('batch-tasks');
            const div = document.createElement('div');
            div.className = 'batch-item';
            div.innerHTML = \`
                <select class="batch-agent">
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                </select>
                <input type="text" class="batch-prompt" placeholder="Task prompt...">
                <button class="btn-danger" onclick="removeBatchItem(this)">-</button>
            \`;
            container.appendChild(div);
        }

        function removeBatchItem(btn) {
            const items = document.querySelectorAll('.batch-item');
            if (items.length > 1) {
                btn.parentElement.remove();
            }
        }

        function runBatch() {
            const items = document.querySelectorAll('.batch-item');
            const tasks = [];
            items.forEach(item => {
                const agent = item.querySelector('.batch-agent').value;
                const prompt = item.querySelector('.batch-prompt').value;
                if (prompt) {
                    tasks.push({ agent, prompt });
                }
            });
            if (tasks.length === 0) return alert('Please add at least one task');
            vscode.postMessage({ command: 'runBatch', tasks });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function cancelTask(taskId) {
            vscode.postMessage({ command: 'cancelTask', taskId });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateTasks') {
                const container = document.getElementById('task-list');
                container.innerHTML = message.tasks.map(task => \`
                    <div class="task-item">
                        <span class="task-agent \${task.agent}">\${task.agent}</span>
                        <span class="task-prompt">\${task.prompt}</span>
                        <span class="task-status \${task.status}">\${task.status} \${task.status === 'running' ? '(' + task.progress + '%)' : ''}</span>
                        \${task.status === 'running' ? '<button class="btn-danger" onclick="cancelTask(\\'' + task.id + '\\')">Cancel</button>' : ''}
                    </div>
                \`).join('');
            }
        });

        // Initial refresh
        refresh();
    </script>
</body>
</html>`;
    }

    public dispose() {
        MultiTaskPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
