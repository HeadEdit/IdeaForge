import { NO_CHAT_SKILL } from '../../domain/chat-turns';
import { listChatSkills } from '../../skills/registry';

export const CHAT_SKILL_GAME_GROUP = 'game';
export const CHAT_SKILL_GENERAL_GROUP = 'general';

export interface ChatSkillMenuOption {
  value: string;
  label: string;
  children?: ChatSkillMenuOption[];
}

function chatSkillIds(group: 'game' | 'general'): string[] {
  return listChatSkills().filter((skill) => skill.chat?.group === group).map((skill) => skill.id);
}

function skillLeaf(id: string): ChatSkillMenuOption {
  const skill = listChatSkills().find((candidate) => candidate.id === id);
  return { value: id, label: skill?.name ?? id };
}

export function listChatSkillMenuOptions(): ChatSkillMenuOption[] {
  return [
    { value: NO_CHAT_SKILL, label: '不使用技能' },
    {
      value: CHAT_SKILL_GAME_GROUP,
      label: '游戏',
      children: chatSkillIds('game').map(skillLeaf),
    },
    {
      value: CHAT_SKILL_GENERAL_GROUP,
      label: '通用',
      children: chatSkillIds('general').map(skillLeaf),
    },
  ];
}

export function chatSkillIdToMenuPath(skillId: string): string[] {
  if (!skillId || skillId === NO_CHAT_SKILL) {
    return [NO_CHAT_SKILL];
  }
  if (chatSkillIds('game').includes(skillId)) {
    return [CHAT_SKILL_GAME_GROUP, skillId];
  }
  if (chatSkillIds('general').includes(skillId)) {
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
