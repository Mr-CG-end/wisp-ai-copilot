import { beforeEach, describe, expect, it } from 'vitest';
import type { CurrentTask, PageInfo } from './store';
import { usePanelStore } from './store';

const sampleCtx = { tabId: 1, url: 'https://example.com', epoch: 1 };
const sampleTask: CurrentTask = {
  id: 'task-1',
  type: 'summary',
  ctx: sampleCtx,
  status: 'loading',
  retryable: true,
  source: 'https://example.com',
};
const samplePage: PageInfo = {
  ctx: sampleCtx,
  title: '示例页面',
  url: 'https://example.com',
  text: '这是页面正文',
  charCount: 6,
  truncated: false,
  method: 'readability',
  readAt: 0,
};

describe('usePanelStore', () => {
  beforeEach(() => {
    usePanelStore.getState().reset();
  });

  it('初始状态符合规范', () => {
    const s = usePanelStore.getState();
    expect(s.modelStatus).toBe('uninitialized');
    expect(s.modelBackend).toBeNull();
    expect(s.downloadPct).toBe(0);
    expect(s.boundCtx).toBeNull();
    expect(s.page).toBeNull();
    expect(s.currentTask).toBeNull();
    expect(s.streamBuffer).toBe('');
    expect(s.history).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.performanceProfile).toBe('resource-saver');
  });

  it('setPerformanceProfile 生效且不影响其他字段', () => {
    const store = usePanelStore.getState();
    store.setPage(samplePage);
    store.startTask(sampleTask);
    store.appendStream('task-1', '已生成内容');

    store.setPerformanceProfile('balanced');

    const s = usePanelStore.getState();
    expect(s.performanceProfile).toBe('balanced');
    expect(s.page?.url).toBe('https://example.com');
    expect(s.currentTask?.id).toBe('task-1');
    expect(s.streamBuffer).toBe('已生成内容');
  });

  it('startTask 会清空上一任务输出、统计和错误', () => {
    const store = usePanelStore.getState();
    store.startTask(sampleTask);
    store.appendStream('task-1', '部分输出');
    store.setError({ code: 'WORKER_ERROR', message: 'Err', retryable: true });

    const newTask: CurrentTask = { ...sampleTask, id: 'task-2' };
    store.startTask(newTask);

    const s = usePanelStore.getState();
    expect(s.currentTask?.id).toBe('task-2');
    expect(s.streamBuffer).toBe('');
    expect(s.history).toEqual([
      expect.objectContaining({
        id: 'task-1',
        output: '部分输出',
      }),
    ]);
    expect(s.error).toBeNull();
  });

  it('finishTask 在输出为空白时写入 empty，有内容时写入 success', () => {
    const store = usePanelStore.getState();

    // 1. 空白输出
    store.startTask(sampleTask);
    store.appendStream('task-1', '   \n  ');
    store.finishTask('task-1');
    expect(usePanelStore.getState().currentTask?.status).toBe('empty');

    // 2. 有内容输出
    store.startTask({ ...sampleTask, id: 'task-2' });
    store.appendStream('task-2', '摘要文本');
    store.finishTask('task-2', { truncated: true });
    expect(usePanelStore.getState().currentTask?.status).toBe('success');
    expect(usePanelStore.getState().currentTask?.truncated).toBe(true);
  });

  it('重新生成时可以替换当前回答而不写入历史', () => {
    const store = usePanelStore.getState();
    store.startTask(sampleTask);
    store.appendStream('task-1', '需要替换的回答');
    store.finishTask('task-1');

    store.startTask({ ...sampleTask, id: 'task-2' }, { archiveCurrent: false });

    expect(usePanelStore.getState().history).toEqual([]);
    expect(usePanelStore.getState().currentTask?.id).toBe('task-2');
  });

  it('cancelTask 保留 streamBuffer 并改状态为 cancelled', () => {
    const store = usePanelStore.getState();
    store.startTask(sampleTask);
    store.appendStream('task-1', '已生成的半句');
    store.cancelTask('task-1');

    const s = usePanelStore.getState();
    expect(s.currentTask?.status).toBe('cancelled');
    expect(s.streamBuffer).toBe('已生成的半句');

    store.finishTask('task-1');
    store.failTask('task-1', { code: 'WORKER_ERROR', message: '迟到错误', retryable: true });
    store.appendStream('task-1', '不应追加的迟到内容');
    expect(usePanelStore.getState().currentTask?.status).toBe('cancelled');
    expect(usePanelStore.getState().streamBuffer).toBe('已生成的半句');
  });

  it('failTask 保留 streamBuffer 并设置 error', () => {
    const store = usePanelStore.getState();
    store.startTask(sampleTask);
    store.appendStream('task-1', '中断前的文本');
    store.failTask('task-1', { code: 'WORKER_ERROR', message: '崩了', retryable: true });

    const s = usePanelStore.getState();
    expect(s.currentTask?.status).toBe('error');
    expect(s.streamBuffer).toBe('中断前的文本');
    expect(s.error).toEqual({ code: 'WORKER_ERROR', message: '崩了', retryable: true });
  });

  it('无当前任务或 taskId 不匹配时调用回调不起作用', () => {
    const store = usePanelStore.getState();
    store.appendStream('task-unknown', '文本');
    expect(usePanelStore.getState().streamBuffer).toBe('');

    store.startTask(sampleTask);
    store.appendStream('task-wrong', '错误ID文本');
    expect(usePanelStore.getState().streamBuffer).toBe('');

    store.finishTask('task-wrong');
    expect(usePanelStore.getState().currentTask?.status).toBe('loading');

    store.cancelTask('task-wrong');
    expect(usePanelStore.getState().currentTask?.status).toBe('loading');
  });

  it('setPage 不自动清除旧结果', () => {
    const store = usePanelStore.getState();
    store.startTask(sampleTask);
    store.appendStream('task-1', '旧页面生成的摘要');
    store.finishTask('task-1');

    const newPage: PageInfo = { ...samplePage, url: 'https://example.com/page2' };
    store.setPage(newPage);

    const s = usePanelStore.getState();
    expect(s.page?.url).toBe('https://example.com/page2');
    expect(s.currentTask?.id).toBe('task-1');
    expect(s.streamBuffer).toBe('旧页面生成的摘要');
  });

  it('reset 能完全恢复初始状态', () => {
    const store = usePanelStore.getState();
    store.setModelStatus('ready');
    store.setModelBackend('webgpu');
    store.setBoundCtx(sampleCtx);
    store.setPage(samplePage);
    store.startTask(sampleTask);
    store.appendStream('task-1', '内容');

    store.reset();
    expect(usePanelStore.getState().modelStatus).toBe('uninitialized');
    expect(usePanelStore.getState().modelBackend).toBeNull();
    expect(usePanelStore.getState().currentTask).toBeNull();
    expect(usePanelStore.getState().streamBuffer).toBe('');
  });
});
