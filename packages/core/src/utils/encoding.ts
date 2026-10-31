import iconv from 'iconv-lite';

/**
 * 编码工具（移植自原项目 encodingUtils.ts）
 * 处理 GB2312/GBK 财经站点的乱码问题：axios 以 arraybuffer 接收后统一走此解码。
 */

/** 从 HTML 文本中检测 charset 声明 */
export function detectCharset(html: string): string {
  const metaCharset = html.match(/<meta[^>]+charset=["']?([a-zA-Z0-9\-_]+)/i);
  if (metaCharset) return metaCharset[1].toUpperCase().trim();

  const httpEquiv = html.match(/content=["']text\/html;\s*charset=([a-zA-Z0-9\-_]+)/i);
  if (httpEquiv) return httpEquiv[1].toUpperCase().trim();

  return 'UTF-8';
}

/** 按 HTML 声明的 charset 解码 ArrayBuffer（GBK 系走 iconv-lite，其余 UTF-8） */
export function decodeHtmlBuffer(buffer: ArrayBuffer | Buffer, fallbackCharset?: string): string {
  const buf: Buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
  const utf8Text = buf.toString('utf-8');
  const charset = (fallbackCharset || detectCharset(utf8Text)).toUpperCase();

  if (charset === 'UTF-8' || charset === 'UTF8') return utf8Text;
  if (iconv.encodingExists(charset)) return iconv.decode(buf, charset);

  console.warn(`[encoding] Unknown charset "${charset}", falling back to UTF-8`);
  return utf8Text;
}

/** 子进程 stdout 乱码兜底：UTF-8 出现替换字符则尝试 GBK */
export function decodeProcessOutput(buf: Buffer): string {
  const utf8 = buf.toString('utf-8');
  if (!utf8.includes('\ufffd')) return utf8;
  try {
    return iconv.decode(buf, 'gbk');
  } catch {
    return utf8;
  }
}

export function stripHtml(html: string): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
