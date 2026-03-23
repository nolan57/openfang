export interface DynamicPattern {
  id: string;
  keywords: string[];
  themes: string[];
  narrativeStructures: string[];
  genreIndicators: string[];
  generatedSkills: string[];
  timestamp: number;
}

// This file is dynamically updated by the PatternMiner
// Initially empty, will be populated during runtime
export const dynamicPatterns: DynamicPattern[] = [];

export function addPattern(pattern: Omit<DynamicPattern, 'id' | 'timestamp'>): void {
  const newPattern: DynamicPattern = {
    id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...pattern,
    timestamp: Date.now()
  };
  dynamicPatterns.push(newPattern);
}

export function getPatterns(): DynamicPattern[] {
  return [...dynamicPatterns];
}

export function clearPatterns(): void {
  dynamicPatterns.length = 0;
}