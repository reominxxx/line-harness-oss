/**
 * 軽量 Markdown → HTML 変換器
 *
 * 月次レポートで使う最小機能のみ:
 *  - # / ## / ### 見出し
 *  - 段落（空行で区切り）
 *  - - / * 箇条書き
 *  - | 表
 *  - **太字** / *斜体*
 *  - ``` コードブロック
 *
 * 外部ライブラリを使わず、Cloudflare Workers にそのまま乗る。
 */

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let inTable = false;
  let tableHeaders: string[] = [];

  const flushList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const flushTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
      tableHeaders = [];
    }
  };

  const inlineFormat = (s: string): string =>
    escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (line.startsWith('```')) {
      flushList();
      flushTable();
      if (inCode) {
        out.push('</pre>');
        inCode = false;
      } else {
        out.push('<pre>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(raw));
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushList();
      flushTable();
      continue;
    }

    if (line.startsWith('# ')) {
      flushList();
      flushTable();
      out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith('## ')) {
      flushList();
      flushTable();
      out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      flushList();
      flushTable();
      out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushTable();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }

    if (line.startsWith('|')) {
      flushList();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (!inTable) {
        // First row = header
        tableHeaders = cells;
        out.push('<table><thead><tr>');
        for (const h of cells) out.push(`<th>${inlineFormat(h)}</th>`);
        out.push('</tr></thead><tbody>');
        inTable = true;
      } else if (cells.every((c) => /^-+$/.test(c) || c === '')) {
        // separator row, skip
        continue;
      } else {
        out.push('<tr>');
        for (const c of cells) out.push(`<td>${inlineFormat(c)}</td>`);
        out.push('</tr>');
      }
      continue;
    }

    flushList();
    flushTable();
    out.push(`<p>${inlineFormat(line)}</p>`);
  }

  flushList();
  flushTable();
  if (inCode) out.push('</pre>');

  return out.join('\n');
}

export function buildReportHtml(opts: { title: string; bodyHtml: string; brand?: string }): string {
  const { title, bodyHtml, brand = 'L-アシスト' } = opts;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif;
    line-height: 1.7;
    color: #1a1a1a;
    background: #f9fafb;
    margin: 0;
    padding: 24px 16px;
  }
  .container {
    max-width: 720px;
    margin: 0 auto;
    background: white;
    padding: 40px 32px;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
  }
  .brand {
    font-size: 12px;
    color: #6b7280;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  h1 { font-size: 24px; font-weight: 600; margin: 0 0 16px; color: #111827; }
  h2 { font-size: 18px; font-weight: 600; margin: 32px 0 12px; color: #111827; padding-top: 8px; border-top: 1px solid #f3f4f6; }
  h3 { font-size: 15px; font-weight: 600; margin: 24px 0 8px; color: #374151; }
  p { margin: 8px 0; }
  ul { margin: 8px 0; padding-left: 24px; }
  li { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f9fafb; font-weight: 600; color: #6b7280; font-size: 12px; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 4px; overflow: auto; font-size: 13px; }
  code { background: #f3f4f6; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
  strong { font-weight: 600; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <div class="brand">${escapeHtml(brand)}</div>
  ${bodyHtml}
  <div class="footer">${escapeHtml(brand)} — AI が中の人として動く LINE 運用プラットフォーム</div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
