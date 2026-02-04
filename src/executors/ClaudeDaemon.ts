import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';

const SESSION_NAME = 'claude-daemon';
const OUTPUT_FILE = '/tmp/claude-daemon-output.txt';

export type InteractionMode = 'interactive' | 'auto';

interface PendingChoice {
    options: string[];
    prompt: string;
}

export class ClaudeDaemon extends EventEmitter {
    private isRunning = false;
    private mode: InteractionMode = 'interactive';

    async start(): Promise<boolean> {
        try {
            // Check if session already exists
            const sessions = this.runWslCommand(`tmux list-sessions 2>/dev/null | grep ${SESSION_NAME} || true`);

            if (sessions.includes(SESSION_NAME)) {
                console.log('Claude daemon already running');
                this.isRunning = true;
                return true;
            }

            // Create new tmux session with Claude in interactive mode
            this.runWslCommand(`tmux new-session -d -s ${SESSION_NAME} "claude 2>&1 | tee ${OUTPUT_FILE}"`);

            // Wait for Claude to initialize
            await this.sleep(3000);

            this.isRunning = true;
            console.log('Claude daemon started');
            return true;

        } catch (error) {
            console.error('Failed to start Claude daemon:', error);
            return false;
        }
    }

    async stop(): Promise<void> {
        try {
            this.runWslCommand(`tmux kill-session -t ${SESSION_NAME} 2>/dev/null || true`);
            this.isRunning = false;
            console.log('Claude daemon stopped');
        } catch (error) {
            console.error('Failed to stop Claude daemon:', error);
        }
    }

    setMode(mode: InteractionMode): void {
        this.mode = mode;
    }

    async sendPrompt(prompt: string): Promise<string> {
        if (!this.isRunning) {
            await this.start();
        }

        try {
            // Clear the output file
            this.runWslCommand(`echo "" > ${OUTPUT_FILE}`);

            // Get current output size
            const beforeSize = this.getOutputSize();

            // Send the prompt
            const escapedPrompt = this.escapeForTmux(prompt);
            this.runWslCommand(`tmux send-keys -t ${SESSION_NAME} "${escapedPrompt}" Enter`);

            // Wait for response with choice detection
            const output = await this.waitForOutputWithChoiceDetection(beforeSize, 120000);

            return output;

        } catch (error) {
            throw new Error(`Claude daemon error: ${(error as Error).message}`);
        }
    }

    async sendKey(key: string): Promise<void> {
        if (!this.isRunning) {
            throw new Error('Claude daemon is not running');
        }

        // Handle special keys
        const keyMap: Record<string, string> = {
            'enter': 'Enter',
            'escape': 'Escape',
            'tab': 'Tab',
            'up': 'Up',
            'down': 'Down',
            'ctrl+c': 'C-c',
            'ctrl+d': 'C-d',
            'y': 'y',
            'n': 'n',
        };

        const tmuxKey = keyMap[key.toLowerCase()] || key;
        this.runWslCommand(`tmux send-keys -t ${SESSION_NAME} "${tmuxKey}"`);
    }

    private async waitForOutputWithChoiceDetection(beforeSize: number, timeoutMs: number): Promise<string> {
        const startTime = Date.now();
        let stableCount = 0;
        let lastSize = beforeSize;
        let lastOutput = '';

        while (Date.now() - startTime < timeoutMs) {
            await this.sleep(500);

            const currentSize = this.getOutputSize();
            const currentOutput = this.runWslCommand(`tail -c +${beforeSize + 1} ${OUTPUT_FILE} 2>/dev/null || true`);
            const cleanOutput = this.cleanOutput(currentOutput);

            // Check for choice patterns (Claude specific)
            const choice = this.detectChoice(cleanOutput);
            if (choice) {
                if (this.mode === 'auto') {
                    // Auto mode: automatically select first option or 'y'
                    await this.autoRespond(choice);
                    stableCount = 0;
                    continue;
                } else {
                    // Interactive mode: ask user
                    const userChoice = await this.askUserForChoice(choice);
                    if (userChoice) {
                        await this.sendKey(userChoice);
                        if (userChoice !== 'enter') {
                            await this.sendKey('enter');
                        }
                        stableCount = 0;
                        continue;
                    }
                }
            }

            // If output size hasn't changed for 2 seconds, assume response is complete
            if (currentSize > beforeSize && currentSize === lastSize && cleanOutput === lastOutput) {
                stableCount++;
                if (stableCount >= 4) {
                    return cleanOutput;
                }
            } else {
                stableCount = 0;
                lastSize = currentSize;
                lastOutput = cleanOutput;
            }
        }

        // Return whatever we have on timeout
        const finalOutput = this.runWslCommand(`tail -c +${beforeSize + 1} ${OUTPUT_FILE} 2>/dev/null || true`);
        return this.cleanOutput(finalOutput);
    }

    private detectChoice(output: string): PendingChoice | null {
        // Claude-specific choice patterns

        // Permission prompts (y/n)
        if (/\(y\/n\)/i.test(output) || /\[y\/N\]/i.test(output) || /\[Y\/n\]/i.test(output)) {
            return {
                options: ['y', 'n'],
                prompt: 'Permission required - Yes or No?'
            };
        }

        // Allow/Deny prompts
        if (/allow|deny|permit/i.test(output) && /\?/.test(output)) {
            return {
                options: ['y', 'n'],
                prompt: 'Allow this action?'
            };
        }

        // Numbered options
        const numberedMatches = output.match(/^\s*\[?(\d+)\]?\s*[.):]\s*(.+)$/gm);
        if (numberedMatches && numberedMatches.length >= 2) {
            const options = numberedMatches.map((_, i) => (i + 1).toString());
            return {
                options,
                prompt: 'Select an option (1-' + options.length + ')'
            };
        }

        // Continue prompts
        if (/press enter|continue\?/i.test(output)) {
            return {
                options: ['enter'],
                prompt: 'Press Enter to continue'
            };
        }

        return null;
    }

    private async autoRespond(choice: PendingChoice): Promise<void> {
        // Auto mode defaults
        if (choice.options.includes('y')) {
            await this.sendKey('y');
            await this.sendKey('enter');
        } else if (choice.options.includes('enter')) {
            await this.sendKey('enter');
        } else if (choice.options.length > 0) {
            // Select first numbered option
            await this.sendKey(choice.options[0]);
            await this.sendKey('enter');
        }
    }

    private async askUserForChoice(choice: PendingChoice): Promise<string | undefined> {
        if (choice.options.includes('enter')) {
            const result = await vscode.window.showInformationMessage(
                'Claude: ' + choice.prompt,
                'Continue'
            );
            return result ? 'enter' : undefined;
        }

        if (choice.options.includes('y') && choice.options.includes('n')) {
            const result = await vscode.window.showQuickPick(
                [
                    { label: 'Yes (Allow)', value: 'y' },
                    { label: 'No (Deny)', value: 'n' }
                ],
                { placeHolder: 'Claude: ' + choice.prompt }
            );
            return result?.value;
        }

        // Numbered options
        const items = choice.options.map(opt => ({
            label: `Option ${opt}`,
            value: opt
        }));

        const result = await vscode.window.showQuickPick(items, {
            placeHolder: 'Claude: ' + choice.prompt
        });

        return result?.value;
    }

    private escapeForTmux(text: string): string {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');
    }

    private getOutputSize(): number {
        try {
            const result = this.runWslCommand(`stat -c%s ${OUTPUT_FILE} 2>/dev/null || echo 0`);
            return parseInt(result.trim(), 10) || 0;
        } catch {
            return 0;
        }
    }

    private cleanOutput(output: string): string {
        return output
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\r/g, '')
            .trim();
    }

    private runWslCommand(command: string): string {
        try {
            const result = execSync(`wsl -d Ubuntu-24.04 -- bash -c "${command}"`, {
                encoding: 'utf8',
                timeout: 120000
            });
            return result;
        } catch (error) {
            const execError = error as any;
            if (execError.stdout) {
                return execError.stdout;
            }
            throw error;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    get running(): boolean {
        return this.isRunning;
    }

    dispose(): void {
        this.stop();
    }
}

// Singleton instance
let claudeDaemonInstance: ClaudeDaemon | null = null;

export function getClaudeDaemon(): ClaudeDaemon {
    if (!claudeDaemonInstance) {
        claudeDaemonInstance = new ClaudeDaemon();
    }
    return claudeDaemonInstance;
}
