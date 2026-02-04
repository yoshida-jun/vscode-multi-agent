import * as vscode from 'vscode';
import { TaskManager } from '../executors/TaskManager';

export class ClaudeParticipant {
    constructor(private taskManager: TaskManager) {}

    async handler(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        const prompt = request.prompt;

        if (!prompt.trim()) {
            stream.markdown('Please provide a prompt for Claude.');
            return { metadata: { command: '' } };
        }

        stream.markdown(`Starting Claude Code task...\n\n`);
        stream.progress('Initializing Claude CLI...');

        try {
            const task = this.taskManager.createTask('claude', prompt);

            // Show task info
            stream.markdown(`**Task ID:** \`${task.id}\`\n\n`);
            stream.markdown(`**Prompt:** ${prompt}\n\n`);
            stream.markdown('---\n\n');

            // Execute and stream output
            const outputPromise = this.taskManager.executeTask(task.id);

            // Listen for progress updates
            const progressHandler = (taskId: string, progress: any) => {
                if (taskId === task.id && progress.type === 'output') {
                    stream.markdown(progress.data);
                }
            };

            this.taskManager.on('taskProgress', progressHandler);

            // Handle cancellation
            token.onCancellationRequested(() => {
                this.taskManager.cancelTask(task.id);
            });

            await outputPromise;

            this.taskManager.off('taskProgress', progressHandler);

            stream.markdown('\n\n---\n\n');
            stream.markdown('Task completed successfully.');

            return {
                metadata: {
                    command: 'claude',
                    taskId: task.id
                }
            };

        } catch (error) {
            stream.markdown(`\n\n**Error:** ${(error as Error).message}`);
            return {
                metadata: {
                    command: 'claude',
                    error: (error as Error).message
                }
            };
        }
    }

    async executeTask(prompt: string): Promise<void> {
        const task = this.taskManager.createTask('claude', prompt);

        try {
            await this.taskManager.executeTask(task.id);
            vscode.window.showInformationMessage(`Claude task ${task.id} completed`);
        } catch (error) {
            vscode.window.showErrorMessage(`Claude task failed: ${(error as Error).message}`);
        }
    }
}
