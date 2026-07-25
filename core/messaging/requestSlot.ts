/**
 * Port 请求的单槽位协调器：同一时刻只允许一个请求，并保证取消/超时只清理自身。
 * 类本身不依赖 React 或 chrome.*，便于覆盖重绑与断连竞态。
 */
export class RequestSlot<T> {
  private pending: {
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  get busy(): boolean {
    return this.pending !== null;
  }

  start(timeoutMs: number): Promise<T> {
    if (this.pending) return Promise.reject(new Error('PORT_BUSY'));

    return new Promise<T>((resolve, reject) => {
      const pending = {
        resolve: (value: T) => {
          if (this.pending !== pending) return;
          clearTimeout(pending.timer);
          this.pending = null;
          resolve(value);
        },
        reject: (error: Error) => {
          if (this.pending !== pending) return;
          clearTimeout(pending.timer);
          this.pending = null;
          reject(error);
        },
        timer: setTimeout(() => {
          pending.reject(new Error('PORT_TIMEOUT'));
        }, timeoutMs),
      };
      this.pending = pending;
    });
  }

  resolve(value: T): void {
    this.pending?.resolve(value);
  }

  cancel(reason: string): void {
    this.pending?.reject(new Error(reason));
  }
}
