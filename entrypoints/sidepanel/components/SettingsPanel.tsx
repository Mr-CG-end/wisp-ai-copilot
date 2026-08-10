import React, { useEffect, useRef, useState } from 'react';
import { useInferenceContext } from '../InferenceProvider';
import { usePanelStore } from '../store';
import {
  MODEL_ID,
  QUANT,
  REVISION,
  WASM_MODEL_SIZE_MB,
} from '../../../core/inference/modelIdentity';
import {
  clearCacheManifest,
  countModelCacheEntries,
  MODEL_CACHE_MANIFEST_KEY,
  purgeModelCacheEntries,
} from '../../../core/inference/modelCache';
import { ERROR_COPY } from '../../../core/panel/errorCopy';
import { purgeSessions } from '../../../core/storage/cleanup';
import { db } from '../../../core/storage/db';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../../../core/storage/settings';
import { collectUsage, formatUsageLine, type UsageSnapshot } from '../../../core/storage/usage';

interface SettingsPanelProps {
  /** 「重新加载模型」把面板切回任务视图，让 ModelSetup 重新挂载走缓存检查。 */
  onBack: () => void;
}

type ClearTarget = 'model' | 'sessions' | 'all';

/** 危险操作的第二步在 5 秒内没被确认就自动还原，误触不会留下一个持续危险的按钮。 */
const CONFIRM_WINDOW_MS = 5000;

const BACKEND_LABEL: Record<'webgpu' | 'wasm', string> = {
  webgpu: 'WebGPU',
  wasm: '兼容模式',
};

const PREFERRED_LABEL: Record<Settings['backend'], string> = {
  auto: '自动（默认）',
  webgpu: 'WebGPU',
  wasm: '兼容模式',
};

/**
 * 「清除全部数据」按键名精确删除，不用 `chrome.storage.local.clear()`。
 * blanket clear 会把模型缓存清单键一并抹掉 —— 用户只想清会话时那是静默破坏：
 * 清单没了，下次启动就得绕「验证旧版本地缓存」那条路。
 */
const CLEARABLE_STORAGE_KEYS: string[] = [
  ...Object.keys(DEFAULT_SETTINGS),
  MODEL_CACHE_MANIFEST_KEY,
];

/**
 * 隐私说明。逐条写明，不用泛泛的「我们重视您的隐私」；
 * 同一份文案后续复用为 Chrome Web Store 的 Data Usage 底稿。
 *
 * 文案红线（阶段二计划 §2 快照语义）：正文只在 readPage() 那一刻取一次，
 * 之后一切生成读的都是内存字符串。任何一条都不得暗示 Wisp 在持续读取或监视页面。
 */
const PRIVACY_NOTICE: readonly string[] = [
  '本地运行：网页正文、选区、提问与回答全部在你的浏览器内处理，不发送到任何服务器。',
  '唯一的出网行为：你点击「开始下载」后，从 huggingface.co 及其 CDN 下载模型权重与分词器。除此之外没有任何业务请求。',
  '无账户、无遥测、无广告 SDK、无远程错误日志。',
  '本地保存的内容：会话与消息存在浏览器 IndexedDB（默认 7 天，可改为「不保留」）；模型权重存在 Cache API；设置存在扩展存储。三者都可在上方逐项清除。',
  '本地数据不做应用层加密，无法防止使用同一操作系统账户的其他人读取。',
  '权限用途：sidePanel 显示界面 · scripting 注入读取脚本 · storage 保存设置 · http(s) 全站访问权限在安装时一次性授予，这样你切换标签页时不必反复授权；Wisp 只在你点击时读取一次网页正文。',
  '正文只在你点击「读取当前页」或使用划词时读取一次，之后每一轮生成用的都是那一份内存快照。',
  '不读取也不写入密码、验证码、支付与身份认证字段；不会自动点击页面上的任何按钮。',
];

async function readUsage(): Promise<UsageSnapshot> {
  return collectUsage({
    estimate: () => navigator.storage.estimate(),
    countCacheEntries: () => countModelCacheEntries(MODEL_ID, REVISION),
    countSessions: () => db.sessions.count(),
  });
}

async function clearModelCache(): Promise<void> {
  await clearCacheManifest();
  await purgeModelCacheEntries(MODEL_ID, REVISION);
}

async function clearSessions(): Promise<void> {
  const ids = await db.sessions.toCollection().primaryKeys();
  await purgeSessions(db, ids);
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ onBack }) => {
  const { getApi, recreate } = useInferenceContext();
  const modelStatus = usePanelStore((s) => s.modelStatus);
  const modelBackend = usePanelStore((s) => s.modelBackend);
  const error = usePanelStore((s) => s.error);
  const setModelStatus = usePanelStore((s) => s.setModelStatus);
  const setModelBackend = usePanelStore((s) => s.setModelBackend);
  const setPage = usePanelStore((s) => s.setPage);
  const resetPanel = usePanelStore((s) => s.reset);
  const cancelTask = usePanelStore((s) => s.cancelTask);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [pendingClear, setPendingClear] = useState<ClearTarget | null>(null);
  const [clearingTarget, setClearingTarget] = useState<ClearTarget | null>(null);
  const [notice, setNotice] = useState<{ text: string; failed: boolean } | null>(null);
  const confirmTimerRef = useRef<number | null>(null);

  const isClearing = clearingTarget !== null;

  const isIncognito = typeof chrome !== 'undefined' && chrome.extension?.inIncognitoContext === true;
  const modelErrorCopy = error && ERROR_COPY[error.code].tier === 'page' ? ERROR_COPY[error.code] : null;
  // 「首选」与「当前运行」不一致才提示。auto 永远算一致：它的语义是先试 WebGPU，
  // 失败了由用户显式选，本来就不预设结果。
  const isBackendDrifted = Boolean(
    modelBackend
    && settings.backend !== 'auto'
    && settings.backend !== modelBackend,
  );

  useEffect(() => {
    void loadSettings().then(setSettings);
    void readUsage().then(setUsage);
  }, []);

  useEffect(() => () => {
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current);
  }, []);

  const disarm = () => {
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    setPendingClear(null);
  };

  const arm = (target: ClearTarget) => {
    disarm();
    setPendingClear(target);
    confirmTimerRef.current = window.setTimeout(() => {
      confirmTimerRef.current = null;
      setPendingClear(null);
    }, CONFIRM_WINDOW_MS);
  };

  const patchSettings = async (patch: Partial<Settings>) => {
    // 保存即写设置，不触发任何下载 —— backend 的语义是「首选后端」而非「立即切换」。
    setSettings(await saveSettings(patch));
  };

  /** 在途生成必须先停：接下来的 recreate() 会终止 Worker，让它无声无息地断在半截。 */
  const stopInFlight = async () => {
    const task = usePanelStore.getState().currentTask;
    if (task?.status !== 'loading') return;
    cancelTask(task.id);
    try {
      await getApi().cancel(task.id);
    } catch (e) {
      console.warn('[wisp] cancel before clear failed:', e);
    }
  };

  /**
   * 模型已经从内存里消失，状态机必须跟着复位。
   * 只把「重开面板就好了」写进文档是不够的：用户清完不会重开面板，
   * 他会顺手回去点「生成摘要」—— 那时 modelStatus 还是 ready，而 Worker 里已经没有模型。
   */
  const resetModelRuntime = () => {
    recreate();
    resetPanel();
    setModelStatus('uninitialized');
    setPage(null);
  };

  const runClear = async (target: ClearTarget) => {
    disarm();
    setClearingTarget(target);
    setNotice(null);
    await stopInFlight();
    try {
      if (target === 'model') {
        await clearModelCache();
        resetModelRuntime();
      } else if (target === 'sessions') {
        await clearSessions();
        // 库清空了而面板上还留着上一轮摘要，等于对用户撒谎，所以连内存里的轮次一起清。
        // 但模型是好的，没有理由顺带把它踢回未初始化 —— reset 后把运行态原样放回去。
        const keptStatus = modelStatus;
        const keptBackend = modelBackend;
        resetPanel();
        setModelBackend(keptBackend);
        setModelStatus(keptStatus);
        setPage(null);
      } else {
        await clearModelCache();
        await clearSessions();
        await chrome.storage.local.remove(CLEARABLE_STORAGE_KEYS);
        setSettings(DEFAULT_SETTINGS);
        resetModelRuntime();
      }
      // PRD §7：清除后必须再次探测并显示实际结果，而不是宣称成功。
      const after = await readUsage();
      setUsage(after);
      setNotice({ text: `已清除 · 当前${formatUsageLine(after)}`, failed: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: `清除未完成：${message}`, failed: true });
    } finally {
      setClearingTarget(null);
    }
  };

  /** 换后端 = 重新走一遍初始化，由 ModelSetup 决定是缓存恢复还是需要下载。 */
  const handleReloadModel = async () => {
    await saveSettings({ backend: settings.backend });
    await stopInFlight();
    resetModelRuntime();
    onBack();
  };

  const clearRow = (target: ClearTarget, label: string, actionLabel: string) => (
    <div className="wisp-meta-item">
      <span className="wisp-meta-label">{label}</span>
      {pendingClear === target ? (
        <span className="wisp-confirm-row">
          <button
            className="wisp-btn-sm wisp-btn-danger-solid"
            disabled={isClearing}
            onClick={() => void runClear(target)}
          >
            确认清除
          </button>
          <button className="wisp-btn-link" onClick={disarm}>取消</button>
        </span>
      ) : (
        <button
          className="wisp-btn-sm wisp-btn-danger"
          disabled={isClearing}
          aria-label={actionLabel}
          onClick={() => arm(target)}
        >
          {clearingTarget === target ? '清除中…' : '清除'}
        </button>
      )}
    </div>
  );

  return (
    <section className="wisp-settings">
      <div className="wisp-settings-group">
        <h2 className="wisp-settings-heading">模型后端</h2>
        <div className="wisp-meta-list">
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">模型</span>
            <span className="wisp-meta-value">Qwen3-0.6B · {REVISION.slice(0, 7)}</span>
          </div>
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">当前运行</span>
            <span className="wisp-meta-value">
              {modelBackend
                ? `${BACKEND_LABEL[modelBackend]} · ${QUANT[modelBackend]}`
                : '未加载'}
            </span>
          </div>
          <div className="wisp-meta-item">
            <label className="wisp-meta-label" htmlFor="wisp-setting-backend">首选</label>
            <select
              id="wisp-setting-backend"
              className="wisp-select"
              value={settings.backend}
              onChange={(event) => {
                void patchSettings({ backend: event.target.value as Settings['backend'] });
              }}
            >
              {(Object.keys(PREFERRED_LABEL) as Settings['backend'][]).map((key) => (
                <option key={key} value={key}>{PREFERRED_LABEL[key]}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="wisp-settings-note">
          兼容模式不占用显卡，因而网页浏览更流畅；它与 WebGPU 使用不同的量化文件，
          切换后需要另外下载约 {WASM_MODEL_SIZE_MB} MB。改这一项只写入设置，不会开始下载。
        </p>

        {modelErrorCopy ? (
          <p className="wisp-settings-note">
            {modelErrorCopy.title}。{modelErrorCopy.hint}
          </p>
        ) : null}

        {isBackendDrifted ? (
          <div className="wisp-status-banner is-warning wisp-settings-banner">
            <div>
              <strong>首选后端尚未生效</strong>
              <span>
                {`现在运行的是${BACKEND_LABEL[modelBackend!]}。切到${PREFERRED_LABEL[settings.backend]}`
                  + '需要重新加载模型；若对应权重还没下载过，会先停在下载确认页。'}
              </span>
            </div>
            <button className="wisp-btn wisp-btn-secondary" onClick={() => void handleReloadModel()}>
              重新加载模型
            </button>
          </div>
        ) : null}
      </div>

      <div className="wisp-settings-group">
        <h2 className="wisp-settings-heading">保留时长</h2>
        <div className="wisp-meta-list">
          <div className="wisp-meta-item">
            <label className="wisp-meta-label" htmlFor="wisp-setting-retention">会话记录</label>
            <select
              id="wisp-setting-retention"
              className="wisp-select"
              value={String(settings.retentionDays)}
              onChange={(event) => {
                void patchSettings({ retentionDays: Number(event.target.value) === 0 ? 0 : 7 });
              }}
            >
              <option value="7">7 天（默认）</option>
              <option value="0">不保留</option>
            </select>
          </div>
        </div>
        <p className="wisp-settings-note">
          选「不保留」后，关闭标签页即清除该标签页的会话与消息。
        </p>
      </div>

      <div className="wisp-settings-group">
        <h2 className="wisp-settings-heading">数据用量</h2>
        <div className="wisp-meta-list">
          <div className="wisp-meta-item">
            <span className="wisp-meta-label">本机占用</span>
            <span className="wisp-meta-value wisp-settings-usage">
              {usage ? formatUsageLine(usage) : '正在统计…'}
            </span>
          </div>
        </div>
        {isIncognito ? (
          <p className="wisp-settings-note">本次为隐身窗口：会话不写入本地库，关闭窗口即消失。</p>
        ) : null}
      </div>

      <div className="wisp-settings-group">
        <h2 className="wisp-settings-heading">清除数据</h2>
        <div className="wisp-meta-list">
          {clearRow('model', '模型缓存', '清理模型缓存')}
          {clearRow('sessions', '会话记录', '清除会话记录')}
          {clearRow('all', '全部数据', '清除全部数据')}
        </div>
        <p className="wisp-settings-note">
          全部数据 = 模型缓存 + 会话记录 + 设置项。清除模型缓存后需要重新下载模型才能继续使用。
        </p>
        {/*
          设置视图下 TaskPanel 未挂载，这条就是面板上唯一的 live region，不会和状态行抢读。
          播报文本与可见文本是同一个节点，避免读屏把同一件事念两遍（UISpec §5.12）。
        */}
        <p
          className={`wisp-settings-result ${notice?.failed ? 'is-failed' : ''}`}
          role="status"
          aria-live="polite"
        >
          {notice?.text ?? ''}
        </p>
      </div>

      <div className="wisp-settings-group">
        <h2 className="wisp-settings-heading">隐私说明</h2>
        <ul className="wisp-privacy-list">
          {PRIVACY_NOTICE.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
    </section>
  );
};
