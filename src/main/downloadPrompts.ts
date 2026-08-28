import { ipcMain, shell, type BrowserWindow } from 'electron';
import { isSafeToOpen } from './executableClassifier';
import { buildViewUrl, openChildWindow } from './windows';

export interface DownloadPromptInfo {
  id: string;
  filename: string;
  filePath: string;
  canOpen: boolean;
}

export type NewDownloadPrompt = Omit<DownloadPromptInfo, 'id'>;

export class DownloadPromptQueue {
  private readonly preloadPath: string;
  private readonly rendererUrl: string;
  private readonly queue: DownloadPromptInfo[] = [];
  private readonly infoById = new Map<string, DownloadPromptInfo>();
  private readonly windowById = new Map<string, BrowserWindow>();
  private activeId: string | null = null;
  private nextId = 0;

  constructor(preloadPath: string, rendererUrl: string) {
    this.preloadPath = preloadPath;
    this.rendererUrl = rendererUrl;
  }

  enqueue(prompt: NewDownloadPrompt): void {
    this.nextId += 1;
    const info: DownloadPromptInfo = { ...prompt, id: `download-${this.nextId}` };
    this.infoById.set(info.id, info);
    this.queue.push(info);
    if (this.activeId === null) {
      this.showNext();
    }
  }

  getInfo(id: string): DownloadPromptInfo | undefined {
    return this.infoById.get(id);
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.activeId = null;
      return;
    }
    this.activeId = next.id;
    this.openWindow(next);
  }

  private openWindow(info: DownloadPromptInfo): void {
    const win = openChildWindow({
      title: 'WhatsApp — Download complete',
      width: 440,
      height: 280,
      minWidth: 360,
      minHeight: 280,
      preloadPath: this.preloadPath,
      url: buildViewUrl(this.rendererUrl, `view=download-prompt&id=${info.id}`),
    });

    this.windowById.set(info.id, win);

    win.on('closed', () => {
      this.windowById.delete(info.id);
      this.infoById.delete(info.id);
      if (this.activeId === info.id) {
        this.showNext();
      }
    });
  }

  private closePrompt(id: string): void {
    const win = this.windowById.get(id);
    if (win && !win.isDestroyed()) {
      win.close();
    } else {
      this.infoById.delete(id);
      if (this.activeId === id) this.showNext();
    }
  }

  dismiss(id: string): void {
    this.closePrompt(id);
  }

  async open(id: string): Promise<void> {
    const info = this.infoById.get(id);
    if (!info) return;
    if (!info.canOpen || !(await isSafeToOpen(info.filePath))) {
      throw new Error(`Refusing to open ${info.filename}: this file type is not safe to open.`);
    }
    const errorMessage = await shell.openPath(info.filePath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    this.closePrompt(id);
  }

  reveal(id: string): void {
    const info = this.infoById.get(id);
    this.closePrompt(id);
    if (!info) return;
    shell.showItemInFolder(info.filePath);
  }
}

export function registerDownloadPromptIpc(queue: DownloadPromptQueue): void {
  ipcMain.handle('download-prompt:get-info', (_event, id: string) => {
    return queue.getInfo(id) ?? null;
  });

  ipcMain.handle('download-prompt:open', async (_event, id: string) => {
    await queue.open(id);
  });

  ipcMain.handle('download-prompt:reveal', (_event, id: string) => {
    queue.reveal(id);
  });

  ipcMain.handle('download-prompt:dismiss', (_event, id: string) => {
    queue.dismiss(id);
  });
}
