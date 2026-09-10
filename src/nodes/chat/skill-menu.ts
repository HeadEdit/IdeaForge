import { NO_CHAT_SKILL } from '../../domain/chat-turns';
import { getSkill } from '../../skills/registry';

export const CHAT_SKILL_GAME_GROUP = 'game';
export const CHAT_SKILL_GENERAL_GROUP = 'general';

export interface ChatSkillMenuOption {
  value: string;
  label: string;
  children?: ChatSkillMenuOption[];
}

const GAME_SKILL_IDS = [
  'game-concept',
  'gameplay-designer',
  'numeric-designer',
  'system-designer',
  'design-review',
  'playtest',
  'quick-design',
] as const;

const GENERAL_SKILL_IDS = ['brainstorm'] as const;

function skillLeaf(id: string): ChatSkillMenuOption {
  return { value: id, label: getSkill(id)?.name ?? id };
}

export function listChatSkillMenuOptions(): ChatSkillMenuOption[] {
  return [
    { value: NO_CHAT_SKILL, label: '不使用技能' },
    {
      value: CHAT_SKILL_GAME_GROUP,
      label: '游戏',
      children: GAME_SKILL_IDS.map(skillLeaf),
    },
    {
      value: CHAT_SKILL_GENERAL_GROUP,
      label: '通用',
      children: GENERAL_SKILL_IDS.map(skillLeaf),
    },
  ];
}

export function chatSkillIdToMenuPath(skillId: string): string[] {
  if (!skillId || skillId === NO_CHAT_SKILL) {
    return [NO_CHAT_SKILL];
  }
  if ((GAME_SKILL_IDS as readonly string[]).includes(skillId)) {
    return [CHAT_SKILL_GAME_GROUP, skillId];
  }
  if ((GENERAL_SKILL_IDS as readonly string[]).includes(skillId)) {
    return [CHAT_SKILL_GENERAL_GROUP, skillId];
  }
  return [skillId];
}

export function chatSkillMenuPathToId(path: readonly (string | number)[]): string {
  if (path.length === 0) {
    return NO_CHAT_SKILL;
  }
  return String(path[path.length - 1]);
}
