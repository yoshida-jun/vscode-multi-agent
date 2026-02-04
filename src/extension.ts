import * as vscode from 'vscode';
import { ClaudeParticipant } from './participants/claudeParticipant';
import { GeminiParticipant } from './participants/geminiParticipant';
import { TaskTreeProvider } from './providers/TaskTreeProvider';
import { TaskManager } from './executors/TaskManager';
import { AutomationService } from './automations/AutomationService';
import { MultiTaskPanel } from './providers/MultiTaskPanel';
import { InputPanelProvider } from './providers/InputPanelProvider';

let taskManager: TaskManager;
let automationService: AutomationService;

export function activate(context: vscode.ExtensionContext) {
    console.log('Multi-Agent Manager is now active!');

    // Initialize Task Manager
    taskManager = new TaskManager();

    // Initialize Tree View Provider
    const taskTreeProvider = new TaskTreeProvider(taskManager);
    vscode.window.registerTreeDataProvider('multiAgent.runningTasks', taskTreeProvider);
    vscode.window.registerTreeDataProvider('multiAgent.taskHistory', taskTreeProvider);

    // Initialize Automation Service
    automationService = new AutomationService(context);
    const automationTreeProvider = automationService.getTreeProvider();
    vscode.window.registerTreeDataProvider('multiAgent.automations', automationTreeProvider);

    // Initialize Input Panel (Sidebar Webview)
    const inputPanelProvider = new InputPanelProvider(context.extensionUri, taskManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('multiAgent.inputPanel', inputPanelProvider)
    );

    // Register Chat Participants
    const claudeParticipant = new ClaudeParticipant(taskManager);
    const geminiParticipant = new GeminiParticipant(taskManager);

    context.subscriptions.push(
        vscode.chat.createChatParticipant('multi-agent.claude', claudeParticipant.handler.bind(claudeParticipant)),
        vscode.chat.createChatParticipant('multi-agent.gemini', geminiParticipant.handler.bind(geminiParticipant))
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('multiAgent.startTask', async () => {
            const agent = await vscode.window.showQuickPick(['Claude', 'Gemini'], {
                placeHolder: 'Select agent'
            });
            if (!agent) return;

            const prompt = await vscode.window.showInputBox({
                prompt: 'Enter your prompt',
                placeHolder: 'What do you want the agent to do?'
            });
            if (!prompt) return;

            if (agent === 'Claude') {
                await claudeParticipant.executeTask(prompt);
            } else {
                await geminiParticipant.executeTask(prompt);
            }
        }),

        vscode.commands.registerCommand('multiAgent.cancelTask', (item) => {
            if (item?.taskId) {
                taskManager.cancelTask(item.taskId);
                vscode.window.showInformationMessage(`Task ${item.taskId} cancelled`);
            }
        }),

        vscode.commands.registerCommand('multiAgent.refreshTasks', () => {
            taskTreeProvider.refresh();
        }),

        vscode.commands.registerCommand('multiAgent.createAutomation', async () => {
            await automationService.createAutomation();
        }),

        // Parallel execution command
        vscode.commands.registerCommand('multiAgent.runParallel', async () => {
            const prompt = await vscode.window.showInputBox({
                prompt: 'Enter your prompt (will run on both Claude and Gemini)',
                placeHolder: 'What do you want both agents to do?'
            });
            if (!prompt) return;

            vscode.window.showInformationMessage('Starting parallel execution on Claude and Gemini...');

            // Run both in parallel
            const claudePromise = claudeParticipant.executeTask(prompt);
            const geminiPromise = geminiParticipant.executeTask(prompt);

            try {
                await Promise.all([claudePromise, geminiPromise]);
                vscode.window.showInformationMessage('Both agents completed!');
            } catch (error) {
                vscode.window.showWarningMessage(`Some tasks failed: ${(error as Error).message}`);
            }
        }),

        // Multi-task panel command
        vscode.commands.registerCommand('multiAgent.openTaskPanel', () => {
            MultiTaskPanel.createOrShow(context.extensionUri, taskManager, claudeParticipant, geminiParticipant);
        }),

        // View task output
        vscode.commands.registerCommand('multiAgent.viewTaskOutput', (item) => {
            if (item?.task) {
                const task = item.task;
                const doc = vscode.workspace.openTextDocument({
                    content: `# Task: ${task.id}\n` +
                        `Agent: ${task.agent}\n` +
                        `Status: ${task.status}\n` +
                        `Created: ${task.createdAt}\n` +
                        `Completed: ${task.completedAt || 'N/A'}\n\n` +
                        `## Prompt\n${task.prompt}\n\n` +
                        `## Output\n${task.output || '(no output)'}`,
                    language: 'markdown'
                });
                doc.then(d => vscode.window.showTextDocument(d));
            }
        })
    );

    // Status Bar
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBarItem.command = 'multiAgent.startTask';
    context.subscriptions.push(statusBarItem);

    taskManager.onTasksChanged(() => {
        const running = taskManager.getRunningTasks().length;
        if (running > 0) {
            statusBarItem.text = `$(loading~spin) Agents: ${running}`;
            statusBarItem.show();
        } else {
            statusBarItem.hide();
        }
        taskTreeProvider.refresh();
    });
}

export function deactivate() {
    if (taskManager) {
        taskManager.dispose();
    }
    if (automationService) {
        automationService.dispose();
    }
}
