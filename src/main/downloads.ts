import type { DownloadItem, Session } from 'electron';

export type DownloadOutcome = 'completed' | 'cancelled' | 'interrupted';

export interface DownloadObserverCallbacks {
  onOutcome: (item: DownloadItem, outcome: DownloadOutcome) => void;
}

export function installDownloadObserver(
  session: Session,
  callbacks: DownloadObserverCallbacks,
): void {
  session.on('will-download', (_event, item) => {
    item.once('done', (_doneEvent, outcome) => {
      callbacks.onOutcome(item, outcome);
    });
  });
}
