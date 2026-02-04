import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export interface TaskProgress {
    type: 'output' | 'error' | 'complete';
    data: string;
    timestamp: Date;
}

export interface ExecuteOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
}

export class CLIExecutor extends EventEmitter {
    private process: ChildProcess | null = null;
    private output: string = '';
    private isRunning: boolean = false;

    constructor(
        private command: string,
        private args: string[] = []
    ) {
        super();
    }

    async execute(options: ExecuteOptions = {}): Promise<string> {
        return new Promise((resolve, reject) => {
            const cwd = options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

            this.isRunning = true;
            this.output = '';

            this.process = spawn(this.command, this.args, {
                cwd,
                env: { ...process.env, ...options.env },
                shell: process.platform === 'win32',
                stdio: ['ignore', 'pipe', 'pipe']  // stdin を無視（入力待ち防止）
            });

            // Timeout handling
            let timeoutId: NodeJS.Timeout | undefined;
            if (options.timeout) {
                timeoutId = setTimeout(() => {
                    this.cancel();
                    reject(new Error(`Command timed out after ${options.timeout}ms`));
                }, options.timeout);
            }

            this.process.stdout?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                this.output += text;
                this.emit('progress', {
                    type: 'output',
                    data: text,
                    timestamp: new Date()
                } as TaskProgress);
            });

            this.process.stderr?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                this.output += text;
                this.emit('progress', {
                    type: 'error',
                    data: text,
                    timestamp: new Date()
                } as TaskProgress);
            });

            this.process.on('close', (code) => {
                if (timeoutId) clearTimeout(timeoutId);
                this.isRunning = false;
                this.process = null;

                this.emit('progress', {
                    type: 'complete',
                    data: `Exit code: ${code}`,
                    timestamp: new Date()
                } as TaskProgress);

                if (code === 0) {
                    resolve(this.output);
                } else {
                    reject(new Error(`Command failed with exit code ${code}\n${this.output}`));
                }
            });

            this.process.on('error', (err) => {
                if (timeoutId) clearTimeout(timeoutId);
                this.isRunning = false;
                this.process = null;
                reject(err);
            });
        });
    }

    cancel(): void {
        if (this.process && this.isRunning) {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', this.process.pid!.toString(), '/f', '/t']);
            } else {
                this.process.kill('SIGTERM');
            }
            this.isRunning = false;
        }
    }

    getOutput(): string {
        return this.output;
    }

    get running(): boolean {
        return this.isRunning;
    }
}
