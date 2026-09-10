import type { DeleteEffectContext, ExecutionEffectContext, NodeEffectContribution } from '../types';
import type { DivergenceConfig } from './config';

export const divergenceEffects: NodeEffectContribution<DivergenceConfig> = {
  executionEffects(context: ExecutionEffectContext<DivergenceConfig>) {
    const produced = context.producedCards ?? [];
    context.capabilities.cards.replaceProducedCards(
      context.nodeId,
      [],
      produced,
    );
    context.capabilities.cards.appendToBoundCollection(
      context.nodeId,
      'pool',
      produced.map((card) => card.id),
    );

    const patch = context.consumeConfigPatch?.();
    if (!patch) return;
    return context.capabilities.workflow.validateConfigPatch(context.nodeId, patch);
  },
  deleteEffects(context: DeleteEffectContext) {
    const removedCardIds = context.capabilities.cards.collectOrphanedCardIds(context.removedNodeIds);
    context.capabilities.cards.replaceProducedCards(context.nodeId, removedCardIds, []);
  },
};
