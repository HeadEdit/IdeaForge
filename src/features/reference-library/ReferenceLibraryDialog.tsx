import { Button, Input, Modal } from 'antd';
import { Download, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useStore } from 'zustand';

import { AppDialog } from '../../components/AppDialog';
import { SafeMarkdown } from '../chat/SafeMarkdown';
import type { ReferenceDocument, ReferenceDocumentFormat } from '../../domain/model';
import type { AppStore } from '../../state/use-app-store';
import { downloadReferenceDocumentMarkdown } from './export';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

function formatLabel(format: ReferenceDocumentFormat): string {
  return { md: 'md', txt: 'txt', manual: '手动' }[format] ?? format;
}

export function ReferenceLibraryDialog({
  open,
  onClose,
  store,
}: {
  open: boolean;
  onClose: () => void;
  store: AppStore;
}) {
  const documents = useStore(store, (state) => state.documents);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => documents.filter((doc) => (
    !needle || doc.title.toLowerCase().includes(needle) || doc.content.toLowerCase().includes(needle)
  )), [documents, needle]);

  const selected = documents.find((doc) => doc.id === selectedId);

  useEffect(() => {
    if (!open) return;
    if (selectedId && documents.some((doc) => doc.id === selectedId)) return;
    setSelectedId(documents[0]?.id);
  }, [open, documents, selectedId]);

  const startCreate = () => {
    setEditingId(undefined);
    setTitle('');
    setContent('');
    setEditorOpen(true);
  };

  const startEdit = (doc: ReferenceDocument) => {
    setSelectedId(doc.id);
    setEditingId(doc.id);
    setTitle(doc.title);
    setContent(doc.content);
    setEditorOpen(true);
  };

  const cancelEdit = () => {
    setEditorOpen(false);
    setEditingId(undefined);
    setTitle('');
    setContent('');
  };

  const selectDocument = (doc: ReferenceDocument) => {
    setSelectedId(doc.id);
    if (editorOpen && editingId !== doc.id) cancelEdit();
  };

  const save = () => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedTitle || !trimmedContent) return;
    if (editingId) {
      store.getState().updateDocument(editingId, { title: trimmedTitle, content: trimmedContent });
      setSelectedId(editingId);
    } else {
      const id = store.getState().addDocument({ title: trimmedTitle, content: trimmedContent, format: 'manual' });
      setSelectedId(id);
    }
    cancelEdit();
  };

  const remove = (doc: ReferenceDocument) => {
    Modal.confirm({
      title: `删除「${doc.title}」？`,
      content: '引用它的节点将自动移除该篇。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        if (editingId === doc.id) cancelEdit();
        store.getState().deleteDocument(doc.id);
      },
    });
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      Modal.error({ title: '文档过大', content: '单文档上限 2MB。' });
      return;
    }
    const name = file.name || '';
    const ext = name.split('.').pop()?.toLowerCase();
    const format: ReferenceDocumentFormat = ext === 'md' || ext === 'markdown' ? 'md' : 'txt';
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '').trim();
      if (!text) {
        Modal.error({ title: '文档为空', content: '文件内容为空，未创建文档。' });
        return;
      }
      const id = store.getState().addDocument({
        title: name.replace(/\.[^.]+$/, ''),
        content: text,
        format,
        sourceName: name,
      });
      setSelectedId(id);
      cancelEdit();
    };
    reader.onerror = () => Modal.error({ title: '读取失败', content: '无法读取该文件。' });
    reader.readAsText(file);
    event.currentTarget.value = '';
  };

  return (
    <AppDialog open={open} title="资料库" onClose={onClose}>
      <div className={`reference-library${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.markdown"
          className="reference-library__file-input"
          aria-label="导入文件"
          onChange={importFile}
        />
        <aside className="reference-library__sidebar" aria-label="资料列表" hidden={sidebarCollapsed}>
          <div className="reference-library__sidebar-head">
            <Input
              aria-label="检索文档"
              allowClear
              value={query}
              placeholder="关键词检索标题与正文…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="text"
              icon={<PanelLeftClose size={16} />}
              aria-label="折叠资料列表"
              title="折叠资料列表"
              onClick={() => setSidebarCollapsed(true)}
            />
          </div>
          <div className="reference-library__sidebar-actions">
            <Button type="primary" icon={<Plus size={15} />} onClick={startCreate}>手动输入</Button>
            <Button icon={<Upload size={15} />} onClick={() => fileInputRef.current?.click()}>导入文件</Button>
          </div>
          <div className="reference-library__list">
            {visible.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className={`reference-library__item${doc.id === selected?.id ? ' is-active' : ''}`}
                onClick={() => selectDocument(doc)}
              >
                <span className="reference-library__item-title">
                  <span className="reference-library-format">{formatLabel(doc.format)}</span>
                  <span>{doc.title}</span>
                </span>
                <span className="reference-library__item-meta">{doc.sourceName ?? '手动输入'}</span>
              </button>
            ))}
            {visible.length === 0 && <p className="empty-state">没有匹配的文档。点「手动输入」或「导入文件」新增。</p>}
          </div>
        </aside>

        <section className="reference-library__reader" aria-label="阅读窗口">
          {editorOpen ? (
            <div className="reference-library__editor">
              <div className="reference-library__editor-head">
                <div className="reference-library__reader-title">
                  {sidebarCollapsed && (
                    <Button
                      type="text"
                      icon={<PanelLeftOpen size={16} />}
                      aria-label="展开资料列表"
                      title="展开资料列表"
                      onClick={() => setSidebarCollapsed(false)}
                    />
                  )}
                  <h3>{editingId ? '编辑文档' : '手动输入'}</h3>
                </div>
                <div className="reference-library__editor-actions">
                  <Button type="primary" onClick={save} disabled={!title.trim() || !content.trim()}>保存</Button>
                  <Button onClick={cancelEdit}>取消</Button>
                </div>
              </div>
              <Input
                aria-label="文档标题"
                value={title}
                placeholder="文档标题"
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input.TextArea
                aria-label="文档内容"
                value={content}
                placeholder="粘贴或输入文档 / 需求正文…"
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
          ) : selected ? (
            <>
              <header className="reference-library__reader-head">
                {sidebarCollapsed && (
                  <Button
                    type="text"
                    icon={<PanelLeftOpen size={16} />}
                    aria-label="展开资料列表"
                    title="展开资料列表"
                    onClick={() => setSidebarCollapsed(false)}
                  />
                )}
                <div className="reference-library__reader-title">
                  <span className="reference-library-format">{formatLabel(selected.format)}</span>
                  <h3>{selected.title}</h3>
                </div>
                <span className="reference-library__reader-meta">{selected.sourceName ?? '手动输入'}</span>
                <div className="reference-library__reader-actions">
                  {sidebarCollapsed && (
                    <>
                      <Button type="primary" icon={<Plus size={15} />} onClick={startCreate}>手动输入</Button>
                      <Button icon={<Upload size={15} />} onClick={() => fileInputRef.current?.click()}>导入文件</Button>
                    </>
                  )}
                  <Button icon={<Pencil size={14} />} onClick={() => startEdit(selected)}>编辑</Button>
                  <Button danger icon={<Trash2 size={14} />} aria-label="删除" onClick={() => remove(selected)} />
                  <Button
                    icon={<Download size={14} />}
                    aria-label="导出 Markdown"
                    title="导出 Markdown"
                    onClick={() => downloadReferenceDocumentMarkdown(selected)}
                  />
                </div>
              </header>
              <article className="reference-library__content">
                {selected.format === 'txt' ? (
                  <pre className="reference-library__plain">{selected.content}</pre>
                ) : (
                  <SafeMarkdown content={selected.content} />
                )}
              </article>
            </>
          ) : (
            <div className="reference-library__placeholder">
              {sidebarCollapsed && (
                <div className="reference-library__reader-actions">
                  <Button
                    type="text"
                    icon={<PanelLeftOpen size={16} />}
                    aria-label="展开资料列表"
                    title="展开资料列表"
                    onClick={() => setSidebarCollapsed(false)}
                  />
                  <Button type="primary" icon={<Plus size={15} />} onClick={startCreate}>手动输入</Button>
                  <Button icon={<Upload size={15} />} onClick={() => fileInputRef.current?.click()}>导入文件</Button>
                </div>
              )}
              <p className="empty-state">选择左侧文档开始阅读，或点「手动输入」「导入文件」新增。</p>
            </div>
          )}
        </section>
      </div>
    </AppDialog>
  );
}
