import type { ReferenceDocument } from '../../domain/model';

export function referenceDocumentMarkdownFilename(title: string): string {
  const safeTitle = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 100);
  return `${safeTitle || 'document'}.md`;
}

export function downloadReferenceDocumentMarkdown(document: ReferenceDocument): void {
  const blob = new Blob([document.content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = referenceDocumentMarkdownFilename(document.title);
    anchor.hidden = true;
    window.document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
