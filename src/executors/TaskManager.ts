import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { CLIExecutor, TaskProgress } from './CLIExecutor';
import { getGeminiDaemon } from './GeminiDaemon';
import { getClaudeDaemon } from './ClaudeDaemon';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentType = 'claude' | 'gemini';

export interface Task {
    id: string;
    agent: AgentType;
    prompt: string;
    status: TaskStatus;
    progress: number;
    output: string;
    createdAt: Date;
    completedAt?: Date;
    error?: string;
}

export class TaskManager extends EventEmitter {
    private tasks: Map<string, Task> = new Map();
    private executors: Map<string, CLIExecutor> = new Map();
    private outputChannels: Map<string, vscode.OutputChannel> = new Map();
    private taskIdCounter = 0;

    constructor() {
        super();
    }

    generateTaskId(): string {
        return `task-${++this.taskIdCounter}-${Date.now()}`;
    }

    createTask(agent: AgentType, prompt: string): Task {
        const task: Task = {
            id: this.generateTaskId(),
            agent,
            prompt,
            status: 'pending',
            progress: 0,
            output: '',
            createdAt: new Date()
        };

        this.tasks.set(task.id, task);
        this.emit('tasksChanged');
        return task;
    }

    async executeTask(taskId: string): Promise<string> {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task ${taskId} not found`);
        }

        // Create output channel (don't auto-show)
        const outputChannel = vscode.window.createOutputChannel(`Agent: ${task.id}`);
        this.outputChannels.set(taskId, outputChannel);
        outputChannel.appendLine(`[${new Date().toISOString()}] Starting ${task.agent} task...`);
        outputChannel.appendLine(`Prompt: ${task.prompt}`);
        outputChannel.appendLine('---');

        // Update task status
        task.status = 'running';
        this.emit('tasksChanged');

        const config = vscode.workspace.getConfiguration('multiAgent');
        const useDaemon = config.get<boolean>('useDaemon', false);

        try {
            let result: string;

            if (useDaemon) {
                // Use daemon for faster response with interactive support
                if (task.agent === 'gemini') {
                    outputChannel.appendLine('[Using Gemini Daemon via WSL/tmux]');
                    const daemon = getGeminiDaemon();
                    result = await daemon.sendPrompt(task.prompt);
                } else {
                    outputChannel.appendLine('[Using Claude Daemon via WSL/tmux]');
                    const daemon = getClaudeDaemon();
                    result = await daemon.sendPrompt(task.prompt);
                }
                outputChannel.append(result);
            } else {
                // Use CLI executor
                const command = task.agent === 'claude'
                    ? config.get<string>('claudePath', 'claude')
                    : config.get<string>('geminiPath', 'gemini');

                const args = this.buildArgs(task.agent, task.prompt);

                // Debug: show exact command being executed
                outputChannel.appendLine(`[DEBUG] Command: ${command}`);
                outputChannel.appendLine(`[DEBUG] Args: ${JSON.stringify(args)}`);
                outputChannel.appendLine(`[DEBUG] Full: ${command} ${args.join(' ')}`);

                const executor = new CLIExecutor(command, args);
                this.executors.set(taskId, executor);

                // Listen to progress
                executor.on('progress', (progress: TaskProgress) => {
                    task.output += progress.data;
                    outputChannel.append(progress.data);

                    if (progress.type === 'output') {
                        task.progress = Math.min(task.progress + 5, 95);
                    }

                    this.emit('taskProgress', taskId, progress);
                    this.emit('tasksChanged');
                });

                result = await executor.execute({
                    timeout: 5 * 60 * 1000 // 5 minutes
                });
            }

            task.output = result;
            task.status = 'completed';
            task.progress = 100;
            task.completedAt = new Date();
            outputChannel.appendLine('---');
            outputChannel.appendLine(`[${new Date().toISOString()}] Task completed successfully`);

            this.emit('tasksChanged');

            return result;

        } catch (error) {
            task.status = 'failed';
            task.error = (error as Error).message;
            task.completedAt = new Date();
            outputChannel.appendLine('---');
            outputChannel.appendLine(`[${new Date().toISOString()}] Task failed: ${task.error}`);

            this.emit('tasksChanged');

            throw error;

        } finally {
            this.executors.delete(taskId);
        }
    }

    private buildArgs(agent: AgentType, prompt: string): string[] {
        if (agent === 'claude') {
            // claude [prompt] -p --output-format text
            return [prompt, '-p', '--output-format', 'text'];
        } else {
            // gemini -p "prompt" --output-format stream-json --yolo
            // --yolo: auto-approve all tool actions (like claude -p)
            // --output-format stream-json: enable streaming progress output
            return ['-p', prompt, '--output-format', 'stream-json', '--yolo'];
        }
    }

    cancelTask(taskId: string): boolean {
        const executor = this.executors.get(taskId);
        const task = this.tasks.get(taskId);

        if (executor && task) {
            executor.cancel();
            task.status = 'cancelled';
            task.completedAt = new Date();
            this.executors.delete(taskId);
            this.emit('tasksChanged');
            return true;
        }

        return false;
    }

    getTask(taskId: string): Task | undefined {
        return this.tasks.get(taskId);
    }

    getAllTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    getRunningTasks(): Task[] {
        return this.getAllTasks().filter(t => t.status === 'running');
    }

    getCompletedTasks(): Task[] {
        return this.getAllTasks().filter(t =>
            t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
        );
    }

    onTasksChanged(callback: () => void): void {
        this.on('tasksChanged', callback);
    }

    dispose(): void {
        // Cancel all running tasks
        for (const [taskId, executor] of this.executors) {
            executor.cancel();
        }
        this.executors.clear();

        // Dispose output channels
        for (const channel of this.outputChannels.values()) {
            channel.dispose();
        }
        this.outputChannels.clear();

        this.removeAllListeners();
    }
}
