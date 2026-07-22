const OPEN = '<think>';
const CLOSE = '</think>';

// 返回 s 结尾处、作为 tag 真前缀的最长长度（0..tag.length-1），
// 用于跨分片挂起尚未判定完的标签尾巴。
function partialSuffix(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (s.slice(s.length - k) === tag.slice(0, k)) return k;
  }
  return 0;
}

/**
 * 流式增量过滤器：从逐段到达的文本中剔除 <think>...</think>，
 * 正确处理标签跨分片、未闭合、空标签等情况，保证 think 内容永不闪现给 UI。
 */
export class ThinkFilter {
  private carry = '';
  private inThink = false;

  push(chunk: string): string {
    this.carry += chunk;
    let out = '';
    while (true) {
      if (!this.inThink) {
        const i = this.carry.indexOf(OPEN);
        if (i !== -1) {
          out += this.carry.slice(0, i);
          this.carry = this.carry.slice(i + OPEN.length);
          this.inThink = true;
          continue;
        }
        const keep = partialSuffix(this.carry, OPEN); // 可能是 <think> 的开头，挂起
        out += this.carry.slice(0, this.carry.length - keep);
        this.carry = this.carry.slice(this.carry.length - keep);
        return out;
      } else {
        const j = this.carry.indexOf(CLOSE);
        if (j !== -1) {
          this.carry = this.carry.slice(j + CLOSE.length);
          this.inThink = false;
          continue;
        }
        const keep = partialSuffix(this.carry, CLOSE); // 丢弃 think 内容，仅挂起可能的 </think> 开头
        this.carry = this.carry.slice(this.carry.length - keep);
        return out;
      }
    }
  }

  flush(): string {
    if (this.inThink) {
      this.carry = '';
      return '';
    } // 未闭合 think：整段丢弃
    const out = this.carry;
    this.carry = '';
    return out; // 挂起的尾巴其实是普通文本
  }
}
