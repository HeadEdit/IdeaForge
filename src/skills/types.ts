export type SkillCategory = 'method' | 'role' | 'assistant';

export interface ChatSkillMetadata {
  group: 'game' | 'general';
  order: number;
  recommendWhen: string;
}

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  systemPrompt: string;
  outputSchema?: object;
  expectedOutputCount?: number;
  antiPatterns?: string[];
  chat?: ChatSkillMetadata;
}
