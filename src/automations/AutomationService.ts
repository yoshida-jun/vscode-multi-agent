import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface Automation {
    id: string;
    name: string;
    agent: 'claude' | 'gemini';
    prompt: string;
    schedule: string; // cron-like or Windows Task Scheduler format
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
}

class AutomationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly automation: Automation,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(automation.name, collapsibleState);

        this.id = automation.id;
        this.description = `${automation.agent} - ${automation.schedule}`;
        this.tooltip = new vscode.MarkdownString(this.getTooltip());
        this.contextValue = automation.enabled ? 'enabledAutomation' : 'disabledAutomation';
        this.iconPath = new vscode.ThemeIcon(
            automation.enabled ? 'clock' : 'circle-slash',
            automation.enabled ? new vscode.ThemeColor('charts.green') : undefined
        );
    }

    private getTooltip(): string {
        const lines = [
            `**Name:** ${this.automation.name}`,
            `**Agent:** ${this.automation.agent}`,
            `**Schedule:** ${this.automation.schedule}`,
            `**Enabled:** ${this.automation.enabled ? 'Yes' : 'No'}`,
            '',
            `**Prompt:**`,
            this.automation.prompt
        ];

        if (this.automation.lastRun) {
            lines.push('', `**Last Run:** ${this.automation.lastRun.toLocaleString()}`);
        }

        return lines.join('\n');
    }
}

class AutomationTreeProvider implements vscode.TreeDataProvider<AutomationTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AutomationTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private automations: Automation[]) {}

    refresh(automations: Automation[]): void {
        this.automations = automations;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AutomationTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AutomationTreeItem): Thenable<AutomationTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items = this.automations.map(auto =>
            new AutomationTreeItem(auto, vscode.TreeItemCollapsibleState.None)
        );

        return Promise.resolve(items);
    }
}

export class AutomationService {
    private automations: Automation[] = [];
    private treeProvider: AutomationTreeProvider;
    private storageUri: vscode.Uri;
    private automationIdCounter = 0;

    constructor(private context: vscode.ExtensionContext) {
        this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, 'automations.json');
        this.treeProvider = new AutomationTreeProvider([]);
        this.loadAutomations();
    }

    getTreeProvider(): vscode.TreeDataProvider<AutomationTreeItem> {
        return this.treeProvider;
    }

    private async loadAutomations(): Promise<void> {
        try {
            const data = await vscode.workspace.fs.readFile(this.storageUri);
            this.automations = JSON.parse(data.toString());
            this.automationIdCounter = this.automations.length;
            this.treeProvider.refresh(this.automations);
        } catch {
            // File doesn't exist yet
            this.automations = [];
        }
    }

    private async saveAutomations(): Promise<void> {
        const data = Buffer.from(JSON.stringify(this.automations, null, 2));
        await vscode.workspace.fs.writeFile(this.storageUri, data);
        this.treeProvider.refresh(this.automations);
    }

    async createAutomation(): Promise<void> {
        // Get automation name
        const name = await vscode.window.showInputBox({
            prompt: 'Automation name',
            placeHolder: 'Daily code review'
        });
        if (!name) return;

        // Select agent
        const agent = await vscode.window.showQuickPick(['claude', 'gemini'], {
            placeHolder: 'Select agent'
        }) as 'claude' | 'gemini' | undefined;
        if (!agent) return;

        // Get prompt
        const prompt = await vscode.window.showInputBox({
            prompt: 'Enter the prompt',
            placeHolder: 'Review the code changes from yesterday'
        });
        if (!prompt) return;

        // Get schedule
        const scheduleType = await vscode.window.showQuickPick([
            { label: 'Daily', value: 'DAILY' },
            { label: 'Hourly', value: 'HOURLY' },
            { label: 'Every 5 minutes (testing)', value: 'MINUTE' },
            { label: 'Custom', value: 'CUSTOM' }
        ], {
            placeHolder: 'Select schedule'
        });
        if (!scheduleType) return;

        let schedule = scheduleType.value;
        let startTime = '09:00';

        if (scheduleType.value === 'DAILY') {
            const time = await vscode.window.showInputBox({
                prompt: 'Start time (HH:MM)',
                value: '09:00'
            });
            if (time) startTime = time;
        }

        const automation: Automation = {
            id: `auto-${++this.automationIdCounter}`,
            name,
            agent,
            prompt,
            schedule: `${schedule} at ${startTime}`,
            enabled: true
        };

        this.automations.push(automation);
        await this.saveAutomations();

        // Register with Windows Task Scheduler
        await this.registerWindowsTask(automation);

        vscode.window.showInformationMessage(`Automation "${name}" created`);
    }

    private async registerWindowsTask(automation: Automation): Promise<void> {
        const config = vscode.workspace.getConfiguration('multiAgent');
        const cliPath = automation.agent === 'claude'
            ? config.get<string>('claudePath', 'claude')
            : config.get<string>('geminiPath', 'gemini');

        // Create a batch script
        const scriptsDir = path.join(this.context.globalStorageUri.fsPath, 'scripts');
        if (!fs.existsSync(scriptsDir)) {
            fs.mkdirSync(scriptsDir, { recursive: true });
        }

        const scriptPath = path.join(scriptsDir, `${automation.id}.bat`);
        const logPath = path.join(scriptsDir, `${automation.id}.log`);

        const args = automation.agent === 'claude'
            ? `-p "${automation.prompt.replace(/"/g, '\\"')}" --output-format text`
            : `chat -m "${automation.prompt.replace(/"/g, '\\"')}"`;

        const scriptContent = `@echo off
echo [%date% %time%] Starting automation: ${automation.name} >> "${logPath}"
${cliPath} ${args} >> "${logPath}" 2>&1
echo [%date% %time%] Automation completed >> "${logPath}"
`;

        fs.writeFileSync(scriptPath, scriptContent);

        // Parse schedule
        let scheduleArgs: string[] = [];
        if (automation.schedule.includes('DAILY')) {
            const timeMatch = automation.schedule.match(/at (\d{2}:\d{2})/);
            const time = timeMatch ? timeMatch[1] : '09:00';
            scheduleArgs = ['/sc', 'DAILY', '/st', time];
        } else if (automation.schedule.includes('HOURLY')) {
            scheduleArgs = ['/sc', 'HOURLY'];
        } else if (automation.schedule.includes('MINUTE')) {
            scheduleArgs = ['/sc', 'MINUTE', '/mo', '5'];
        }

        // Register task using schtasks
        const taskName = `MultiAgent_${automation.id}`;

        return new Promise((resolve, reject) => {
            const proc = spawn('schtasks', [
                '/create',
                '/tn', taskName,
                '/tr', `"${scriptPath}"`,
                ...scheduleArgs,
                '/f' // Force overwrite
            ], { shell: true });

            let stderr = '';
            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    vscode.window.showInformationMessage(
                        `Task scheduled: ${taskName}`
                    );
                    resolve();
                } else {
                    vscode.window.showWarningMessage(
                        `Could not register Windows Task: ${stderr}`
                    );
                    resolve(); // Don't reject, automation is still saved
                }
            });
        });
    }

    async deleteAutomation(automationId: string): Promise<void> {
        const index = this.automations.findIndex(a => a.id === automationId);
        if (index === -1) return;

        const automation = this.automations[index];

        // Remove from Windows Task Scheduler
        const taskName = `MultiAgent_${automation.id}`;
        spawn('schtasks', ['/delete', '/tn', taskName, '/f'], { shell: true });

        this.automations.splice(index, 1);
        await this.saveAutomations();

        vscode.window.showInformationMessage(`Automation "${automation.name}" deleted`);
    }

    async toggleAutomation(automationId: string): Promise<void> {
        const automation = this.automations.find(a => a.id === automationId);
        if (!automation) return;

        automation.enabled = !automation.enabled;

        const taskName = `MultiAgent_${automation.id}`;
        const action = automation.enabled ? '/enable' : '/disable';

        spawn('schtasks', ['/change', '/tn', taskName, action], { shell: true });

        await this.saveAutomations();

        vscode.window.showInformationMessage(
            `Automation "${automation.name}" ${automation.enabled ? 'enabled' : 'disabled'}`
        );
    }

    dispose(): void {
        // Cleanup if needed
    }
}
