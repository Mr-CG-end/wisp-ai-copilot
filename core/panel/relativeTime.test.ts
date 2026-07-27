import { describe, expect, it } from 'vitest';
import { formatReadAt } from './relativeTime';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('formatReadAt', () => {
  it('一分钟内显示「刚刚」', () => {
    expect(formatReadAt(1000, 1000)).toBe('刚刚');
    expect(formatReadAt(1000, 1000 + 59_000)).toBe('刚刚');
  });

  it('一小时内显示分钟', () => {
    expect(formatReadAt(0, MINUTE)).toBe('1 分钟前');
    expect(formatReadAt(0, 3 * MINUTE)).toBe('3 分钟前');
    expect(formatReadAt(0, 59 * MINUTE)).toBe('59 分钟前');
  });

  it('一小时以上显示小时', () => {
    expect(formatReadAt(0, HOUR)).toBe('1 小时前');
    expect(formatReadAt(0, 5 * HOUR)).toBe('5 小时前');
  });

  it('超过一天显示天', () => {
    expect(formatReadAt(0, 24 * HOUR)).toBe('1 天前');
  });

  it('未来时间戳按「刚刚」处理，不出现负数', () => {
    expect(formatReadAt(5000, 1000)).toBe('刚刚');
  });
});
