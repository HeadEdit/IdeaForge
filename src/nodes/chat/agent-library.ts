import { AiClientError } from '../../ai/client';
import type { Workflow } from '../../domain/model';
import type { AgentLibrary } from '../../execution/chat-agent';
import type { RunChatInput } from '../../execution/run-chat';
import { chatConfigSchema } from './config';

export function createChatAgentLibrary(
  input: RunChatInput,
  getWorkflow: () => Workflow | undefined,
  isCurrent: () => boolean,
  library: AgentLibrary,
): AgentLibrary {
  const assertScope = () => {
    const workflow = getWorkflow();
    const node = workflow?.nodes.find((item) => item.id === input.nodeId);
    const config = chatConfigSchema.safeParse(node?.config);
    if (input.signal.aborted || !isCurrent() || workflow?.id !== input.workflowId || node?.kind !== 'chat'
      || !config.success || !config.data.agentMode) {
      throw new AiClientError('stopped', false);
    }
  };
  const list = () => {
    assertScope();
    return library.list().filter((doc) => doc.workflowId === input.workflowId);
  };
  const assertDocument = (id: string) => {
    if (!list().some((doc) => doc.id === id)) throw new Error('文档不存在，请重新查询资料库');
  };
  return {
    list,
    add: (value) => { assertScope(); return library.add(value); },
    update: (id, patch) => { assertDocument(id); library.update(id, patch); },
    delete: (id) => { assertDocument(id); library.delete(id); },
  };
}
