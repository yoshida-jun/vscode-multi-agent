import * as vscode from 'vscode';
import { TaskManager, Task, TaskStatus } from '../executors/TaskManager';

export class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly task: Task,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(task.prompt.substring(0, 50) + (task.prompt.length > 50 ? '...' : ''), collapsibleState);

        this.id = task.id;
        this.description = `${task.agent} - ${task.status}`;
        this.tooltip = new vscode.MarkdownString(this.getTooltip());
        this.contextValue = task.status === 'running' ? 'runningTask' : 'task';
        this.iconPath = this.getIcon();

        if (task.status === 'running') {
            this.description += ` (${task.progress}%)`;
        }
    }

    get taskId(): string {
        return this.task.id;
    }

    private getIcon(): vscode.ThemeIcon {
        const iconMap: Record<TaskStatus, string> = {
            'pending': 'circle-outline',
            'running': 'loading~spin',
            'completed': 'check',
            'failed': 'error',
            'cancelled': 'circle-slash'
        };

        const colorMap: Record<TaskStatus, vscode.ThemeColor | undefined> = {
            'pending': undefined,
            'running': new vscode.ThemeColor('charts.blue'),
            'completed': new vscode.ThemeColor('charts.green'),
            'failed': new vscode.ThemeColor('charts.red'),
            'cancelled': new vscode.ThemeColor('charts.yellow')
        };

        return new vscode.ThemeIcon(iconMap[this.task.status], colorMap[this.task.status]);
    }

    private getTooltip(): string {
        const lines = [
            `**Task ID:** ${this.task.id}`,
            `**Agent:** ${this.task.agent}`,
            `**Status:** ${this.task.status}`,
            `**Created:** ${this.task.createdAt.toLocaleString()}`,
            '',
            `**Prompt:**`,
            this.task.prompt
        ];

        if (this.task.completedAt) {
            lines.splice(4, 0, `**Completed:** ${this.task.completedAt.toLocaleString()}`);
        }

        if (this.task.error) {
            lines.push('', `**Error:** ${this.task.error}`);
        }

        return lines.join('\n');
    }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private taskManager: TaskManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (element) {
            // No children for individual tasks
            return Promise.resolve([]);
        }

        // Get all tasks sorted by creation date (newest first)
        const tasks = this.taskManager.getAllTasks()
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        const items = tasks.map(task =>
            new TaskTreeItem(task, vscode.TreeItemCollapsibleState.None)
        );

        return Promise.resolve(items);
    }
}

export class RunningTasksProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private taskManager: TaskManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const tasks = this.taskManager.getRunningTasks();
        const items = tasks.map(task =>
            new TaskTreeItem(task, vscode.TreeItemCollapsibleState.None)
        );

        return Promise.resolve(items);
    }
}

export class TaskHistoryProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private taskManager: TaskManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const tasks = this.taskManager.getCompletedTasks()
            .sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0));

        const items = tasks.map(task =>
            new TaskTreeItem(task, vscode.TreeItemCollapsibleState.None)
        );

        return Promise.resolve(items);
    }
}
