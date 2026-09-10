import { assistantSkills } from './builtin/assistants';
import { methodSkills } from './builtin/methods';
import { roleSkills } from './builtin/roles';
import type { Skill, SkillCategory } from './types';

const builtins: readonly Skill[] = [
  ...methodSkills,
  ...roleSkills,
  ...assistantSkills,
];

const skillsById = Object.assign(
  Object.create(null),
  Object.fromEntries(builtins.map((skill) => [skill.id, skill])),
) as Record<string, Skill>;

export function getSkill(id: string): Skill | undefined {
  return Object.prototype.hasOwnProperty.call(skillsById, id)
    ? skillsById[id]
    : undefined;
}

export function listSkills(category?: SkillCategory): readonly Skill[] {
  if (category === undefined) {
    return builtins;
  }
  return builtins.filter((skill) => skill.category === category);
}

export function listChatSkills(): readonly Skill[] {
  return builtins
    .filter((skill) => skill.chat !== undefined && (skill.category === 'role' || skill.category === 'assistant'))
    .sort((left, right) => left.chat!.order - right.chat!.order);
}
