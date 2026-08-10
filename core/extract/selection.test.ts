import { describe, expect, it } from 'vitest';
import {
  MAX_SELECTION,
  MIN_SELECTION,
  defaultTargetLang,
  detectLang,
  isSelectionUsable,
  normalizeSelection,
} from './selection';

/** 不可见空白用码位构造，免得源码里躺着几个看不出来的字符。 */
const NBSP = String.fromCodePoint(0x00a0);
const IDEO_SPACE = String.fromCodePoint(0x3000);
const LINE_SEP = String.fromCodePoint(0x2028);
const PARA_SEP = String.fromCodePoint(0x2029);

describe('normalizeSelection', () => {
  it('去首尾空白并折叠内部连续空白', () => {
    expect(normalizeSelection('  你好   世界 \n\n 再见  ')).toBe('你好 世界\n再见');
  });

  it('折叠全角空格与不换行空格', () => {
    expect(normalizeSelection(`你好${IDEO_SPACE}世界`)).toBe('你好 世界');
    expect(normalizeSelection(`Hello${NBSP}${NBSP}world`)).toBe('Hello world');
    expect(normalizeSelection(`${IDEO_SPACE} 你好 ${NBSP}`)).toBe('你好');
  });

  it('CRLF 与软换行统一成 \\n', () => {
    expect(normalizeSelection('第一行\r\n第二行\r第三行')).toBe('第一行\n第二行\n第三行');
    expect(normalizeSelection(`第一行${LINE_SEP}第二行${PARA_SEP}第三行`)).toBe('第一行\n第二行\n第三行');
  });

  it('段落之间的多个空行折叠成单个换行', () => {
    expect(normalizeSelection('一\n\n\n二')).toBe('一\n二');
  });

  it('不把换行改成空格——英文软换行处直接接起来会粘连单词', () => {
    expect(normalizeSelection('quick brown\nfox jumps')).toBe('quick brown\nfox jumps');
  });

  it('纯空白规范化为空串', () => {
    expect(normalizeSelection(` \t${IDEO_SPACE}\n ${NBSP} `)).toBe('');
  });
});

describe('isSelectionUsable', () => {
  it('低于下限不可用', () => {
    expect(isSelectionUsable('一')).toBe(false);
    expect(isSelectionUsable('')).toBe(false);
  });

  it('区间内可用', () => {
    expect(isSelectionUsable('你好')).toBe(true);
    expect(MIN_SELECTION).toBe(2);
  });

  it('上限本身可用，超出即不可用', () => {
    expect(isSelectionUsable('字'.repeat(MAX_SELECTION))).toBe(true);
    expect(isSelectionUsable('字'.repeat(MAX_SELECTION + 1))).toBe(false);
    expect(MAX_SELECTION).toBe(4000);
  });

  it('纯空白选区经规范化后落在下限之外', () => {
    expect(isSelectionUsable(normalizeSelection(`   ${IDEO_SPACE}  `))).toBe(false);
  });

  it('只有标点也算可用——长度守卫不做内容判断', () => {
    expect(isSelectionUsable('？！')).toBe(true);
  });
});

describe('detectLang', () => {
  it('含较多汉字判为 zh', () => {
    expect(detectLang('这是一段中文文本')).toBe('zh');
  });

  it('纯英文判为 en', () => {
    expect(detectLang('This is an English sentence.')).toBe('en');
  });

  it('中英混排以汉字占比为准', () => {
    expect(detectLang('这段文本 mixes 中文 and English 内容')).toBe('zh');
  });

  it('汉字占比 15% 是 zh 与 en 的分界', () => {
    expect(detectLang('中中中abcdefghijklmnopq')).toBe('zh'); // 3 / 20
    expect(detectLang('中中abcdefghijklmnopqr')).toBe('en'); // 2 / 20
  });

  it('无字母无汉字判为 other', () => {
    expect(detectLang('123 456 !!!')).toBe('other');
  });

  it('中文全角标点本身不算汉字', () => {
    expect(detectLang('。。。，，，！')).toBe('other');
  });

  it('空串与纯空白判为 other', () => {
    expect(detectLang('')).toBe('other');
    expect(detectLang(` ${IDEO_SPACE}\n`)).toBe('other');
  });
});

describe('defaultTargetLang', () => {
  it('中文选区默认译成英文，其余默认译成中文', () => {
    expect(defaultTargetLang('zh')).toBe('en');
    expect(defaultTargetLang('en')).toBe('zh');
    expect(defaultTargetLang('other')).toBe('zh');
  });
});
