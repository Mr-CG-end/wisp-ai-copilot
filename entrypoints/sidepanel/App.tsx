import { useState } from 'react';
import * as Comlink from 'comlink';
import { useInference } from './useInference';
import type { GenStats } from '../../core/inference/contract';

export function App() {
  const { getApi, recreate } = useInference();
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [stats, setStats] = useState<GenStats | null>(null);

  const handleGenerate = async () => {
    setOutput('');
    setStats(null);
    setIsGenerating(true);

    try {
      const api = getApi();
      const resStats = await api.generate(
        {
          taskType: 'qa',
          untrustedData: '测试数据',
          params: { maxNewTokens: 100, temperature: 0.7 },
        },
        crypto.randomUUID(),
        Comlink.proxy((delta: string) => {
          setOutput((prev) => prev + delta);
        })
      );
      setStats(resStats);
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>Wisp Spike (Task 5)</h2>
      <div style={{ marginBottom: 12 }}>
        <button onClick={handleGenerate} disabled={isGenerating}>
          {isGenerating ? '生成中...' : '桩生成测试'}
        </button>
        <button onClick={recreate} style={{ marginLeft: 8 }} disabled={isGenerating}>
          重启 Worker
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={{ fontWeight: 'bold' }}>输出内容：</label>
        <pre
          style={{
            background: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            minHeight: 60,
            whiteSpace: 'pre-wrap',
            marginTop: 8,
          }}
        >
          {output}
        </pre>
      </div>
      {stats && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
          <p>
            TTFT: {stats.ttftMs}ms | 速度: {stats.tokensPerSec} tokens/s | 标记数: {stats.tokens}
          </p>
        </div>
      )}
    </main>
  );
}
