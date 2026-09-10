import type { AiClient } from '../ai/client';
import type { ContentExtractConfig } from '../nodes/content-extract/config';
import { contentExtractPrompts } from '../prompts';
import type { NodeRunner, NodeRunnerResult } from './runner-types';

export interface ContentExtractRunnerDependencies {
  getClient: () => AiClient | undefined;
  onConfigPatch: (nodeId: string, patch: Partial<ContentExtractConfig>) => void;
}

const emptyMetrics = {
  requested: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  failedBatchIndexes: [] as number[],
};

export function createContentExtractRunner(
  deps: ContentExtractRunnerDependencies,
): NodeRunner {
  return {
    kind: 'contentExtract',
    requiresAi: true,
    async run(context): Promise<NodeRunnerResult> {
      const input = context.inputs.input;
      if (!input || input.type !== 'Text' || !input.value.trim()) {
        return { ok: false, errorKind: 'invalid-input' };
      }
      const config = context.node.config as ContentExtractConfig;
      const content = input.value;

      if (
        config.summary
        && config.summarySourceContent
        && config.summarySourceContent !== content
        && config.summaryStatus !== 'stale'
      ) {
        deps.onConfigPatch(context.node.id, { summaryStatus: 'stale' });
      }

      const client = deps.getClient();
      if (!client) {
        deps.onConfigPatch(context.node.id, {
          summaryStatus: 'failed',
          lastError: 'AI 未配置',
        });
        return { ok: false, errorKind: 'invalid-response' };
      }

      if (context.signal.aborted) {
        return { ok: false, errorKind: 'stopped' };
      }

      try {
        context.reportProgress?.({ stage: '提取内容摘要', percent: 25, estimated: true });
        const summary = (await client.complete([
          {
            role: 'system',
            content: contentExtractPrompts.summarize,
          },
          {
            role: 'user',
            content,
          },
        ], { signal: context.signal })).trim();
        context.reportProgress?.({ stage: '整理摘要', percent: 85, estimated: true });

        deps.onConfigPatch(context.node.id, {
          summary,
          summarySourceContent: content,
          summaryStatus: 'ready',
          lastError: undefined,
        });
        return {
          ok: true,
          metrics: emptyMetrics,
        };
      } catch (error) {
        if (context.signal.aborted) {
          return { ok: false, errorKind: 'stopped' };
        }
        deps.onConfigPatch(context.node.id, {
          summaryStatus: 'failed',
          lastError: error instanceof Error ? error.message : 'invalid-response',
        });
        return { ok: false, errorKind: 'invalid-response' };
      }
    },
  };
}
