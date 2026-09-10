import type { AiClient } from '../ai/client';
import { buildBriefMessages } from '../ai/prompts';
import { parseBriefFields } from '../ai/schemas';
import {
  formatBriefText,
  type BriefConfig,
} from '../nodes/brief/config';
import type { NodeRunner, NodeRunnerResult } from './runner-types';

type BriefFields = Omit<BriefConfig, 'generationPrompt'>;

export interface BriefRunnerDependencies {
  getClient: () => AiClient | undefined;
  onConfigPatch: (nodeId: string, patch: BriefFields) => void;
}

const successMetrics = {
  requested: 1,
  succeeded: 1,
  failed: 0,
  skipped: 0,
  failedBatchIndexes: [] as number[],
};

export function createBriefRunner(deps: BriefRunnerDependencies): NodeRunner {
  return {
    kind: 'brief',
    requiresAi: true,
    async run(context): Promise<NodeRunnerResult> {
      const config = context.node.config as BriefConfig;
      const source = context.inputs.source;
      const sourceText = source?.type === 'Text' ? source.value.trim() : '';
      const generationPrompt = config.generationPrompt.trim();
      if (!sourceText && !generationPrompt) {
        return { ok: false, errorKind: 'invalid-input' };
      }

      const client = deps.getClient();
      if (!client) {
        return { ok: false, errorKind: 'invalid-response' };
      }
      if (context.signal.aborted) {
        return { ok: false, errorKind: 'stopped' };
      }

      try {
        context.reportProgress?.({ stage: '生成 Brief', percent: 25, estimated: true });
        const raw = await client.complete(
          buildBriefMessages(generationPrompt, sourceText),
          { signal: context.signal, temperature: 0.3 },
        );
        if (context.signal.aborted) {
          return { ok: false, errorKind: 'stopped' };
        }
        context.reportProgress?.({ stage: '解析 Brief', percent: 85, estimated: true });
        const fields = parseBriefFields(raw);
        deps.onConfigPatch(context.node.id, fields);
        return {
          ok: true,
          output: {
            type: 'Text',
            value: formatBriefText({ ...config, ...fields }),
          },
          metrics: successMetrics,
        };
      } catch {
        return {
          ok: false,
          errorKind: context.signal.aborted ? 'stopped' : 'invalid-response',
        };
      }
    },
  };
}
