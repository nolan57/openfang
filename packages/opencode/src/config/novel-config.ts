export interface PatternTemplate {
  rules: string[]
  constraints: string[]
  narrativeHooks: string[]
}

export interface GenreTemplate {
  name: string
  patterns: string[]
  defaultRules: string[]
}

export class NovelConfig {
  private staticPatterns: Record<string, PatternTemplate>
  private genreTemplates: Record<string, GenreTemplate>
  public cliSettings: {
    maxHistoryLength: number
    autoSaveInterval: number
  }

  constructor() {
    this.staticPatterns = {
      "time-loop": {
        rules: ["Events repeat with subtle variations", "Character retains memories across loops"],
        constraints: ["Must have clear loop trigger", "Limited number of iterations"],
        narrativeHooks: ["Discovering the loop mechanism", "Breaking the cycle"],
      },
      "non-linear": {
        rules: ["Timeline jumps between different periods", "Cause-effect relationships span multiple timelines"],
        constraints: ["Clear timeline markers required", "Character continuity must be maintained"],
        narrativeHooks: ["Converging timelines", "Paradox resolution"],
      },
      mystery: {
        rules: ["Clues must be discoverable", "Red herrings allowed but limited"],
        constraints: ["Solution must be logically deducible", "No deus ex machina"],
        narrativeHooks: ["Witness testimony", "Hidden evidence"],
      },
    }

    this.genreTemplates = {
      "sci-fi": {
        name: "Science Fiction",
        patterns: ["time-loop", "non-linear"],
        defaultRules: ["Technology must follow consistent rules", "Explore societal implications"],
      },
      fantasy: {
        name: "Fantasy",
        patterns: ["mystery"],
        defaultRules: ["Magic system must have limitations", "World-building consistency"],
      },
      thriller: {
        name: "Thriller",
        patterns: ["mystery"],
        defaultRules: ["Maintain tension throughout", "Clear stakes and deadlines"],
      },
    }

    this.cliSettings = {
      maxHistoryLength: 1000,
      autoSaveInterval: 30000, // 30 seconds
    }
  }

  public getStaticPatterns(): Record<string, PatternTemplate> {
    return this.staticPatterns
  }

  public getGenreTemplates(): Record<string, GenreTemplate> {
    return this.genreTemplates
  }

  public hasTemplate(name: string): boolean {
    return name in this.staticPatterns || name in this.genreTemplates
  }

  public getTemplate(name: string): PatternTemplate | undefined {
    if (name in this.staticPatterns) {
      return this.staticPatterns[name]
    }

    const genre = this.genreTemplates[name]
    if (genre) {
      return {
        rules: genre.defaultRules,
        constraints: [],
        narrativeHooks: [],
      }
    }

    return undefined
  }
}
