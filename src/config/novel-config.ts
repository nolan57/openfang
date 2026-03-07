export interface NovelConfig {
  defaultPatterns: {
    keywords: string[];
    themes: string[];
    narrativeStructures: string[];
    genreTemplates: Record<string, string[]>;
  };
  cliSettings: {
    defaultExportFormat: string;
    maxHistorySegments: number;
    autoSaveInterval: number; // in seconds
  };
  stateFile: string;
}

export const novelConfig: NovelConfig = {
  defaultPatterns: {
    keywords: ['character', 'setting', 'conflict', 'resolution', 'theme'],
    themes: ['redemption', 'betrayal', 'discovery', 'transformation'],
    narrativeStructures: ['three-act', 'hero-journey', 'kitchen-sink'],
    genreTemplates: {
      'sci-fi': ['spaceship', 'alien', 'future', 'technology', 'dystopia'],
      'fantasy': ['magic', 'dragon', 'kingdom', 'quest', 'prophecy'],
      'mystery': ['detective', 'clue', 'suspect', 'alibi', 'revelation'],
      'romance': ['love', 'relationship', 'obstacle', 'confession', 'reunion']
    }
  },
  cliSettings: {
    defaultExportFormat: 'md',
    maxHistorySegments: 100,
    autoSaveInterval: 30
  },
  stateFile: './novel_state.json'
};