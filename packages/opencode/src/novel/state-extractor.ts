import { Log } from "../util/log";
import { generateText } from "ai";
import { Provider } from "../provider/provider";
import {
	TRAUMA_TAGS,
	SKILL_CATEGORIES,
	CHARACTER_STATUS,
	EMOTION_TYPES,
	GOAL_TYPES,
	SALIENCE_LEVELS,
} from "./types";
import type {
	OutcomeType,
	CharacterState,
	TraumaEntry,
	SkillEntry,
	TurnResult,
	StateUpdate,
	ProposedChanges,
	ValidatedChanges,
} from "../types/novel-state";
import {
	validateSkillAward,
	validateTraumaSeverity,
	calculateStressDelta,
} from "../types/novel-state";
import { buildStateExtractionPrompt } from "../prompts/state-extraction-prompt";
import { getNovelLanguageModel } from "./model";

const log = Log.create({ service: "state-extractor" });

interface CharacterUpdate {
	traits?: string[];
	stress?: number;
	status?: string;
	emotions?: {
		valence?: number;
		arousal?: number;
		dominant?: string;
	};
	newTrauma?: {
		name: string;
		description: string;
		tags: string[];
		severity: number;
		source_event: string;
	};
	newSkill?: {
		name: string;
		category: string;
		level: number;
		description: string;
		source_event: string;
		difficulty: number;
	};
	secrets?: string[];
	clues?: string[];
	goals?: GoalUpdate[];
	notes?: string;
	relationships?: Record<string, number>;
}

interface GoalUpdate {
	type: string;
	description: string;
	priority: number;
	status: "active" | "completed" | "failed" | "abandoned" | "paused";
}

interface RelationshipUpdate {
	trust?: number;
	hostility?: number;
	dominance?: number;
	friendliness?: number;
	dynamic?: string;
	attachmentStyle?: string;
	notes?: string;
}

interface WorldUpdate {
	events?: string[];
	timeProgression?: string;
	location?: string;
	threats?: string[];
	opportunities?: string[];
	activeClues?: string[];
}

interface EvolutionSummary {
	timestamp: number;
	chapter: number;
	turn: number;
	changes: {
		newCharacters: number;
		updatedCharacters: string[];
		newRelationships: number;
		updatedRelationships: string[];
		newEvents: number;
		newTraumas: number;
		newSkills: number;
		stressChanges: { character: string; delta: number; cause?: string }[];
	};
	highlights: string[];
	contradictions: string[];
	auditFlags?: {
		type:
			| "SKILL_IN_FAILURE"
			| "MISSING_TRAUMA"
			| "INFLATION"
			| "IMPOSSIBLE_CHANGE"
			| "STRESS_OVERFLOW";
		description: string;
		corrected: boolean;
	}[];
}

interface LocalEvolutionSummary {
	timestamp: number;
	chapter: number;
	turn: number;
	changes: {
		newCharacters: number;
		updatedCharacters: string[];
		newRelationships: number;
		updatedRelationships: string[];
		newEvents: number;
		newTraumas: number;
		newSkills: number;
		stressChanges: { character: string; delta: number; cause?: string }[];
	};
	highlights: string[];
	contradictions: string[];
	auditFlags?: {
		type:
			| "SKILL_IN_FAILURE"
			| "MISSING_TRAUMA"
			| "INFLATION"
			| "IMPOSSIBLE_CHANGE";
		description: string;
		corrected: boolean;
	}[];
}

interface TurnEvaluation {
	outcome_type: OutcomeType;
	challenge_difficulty: number;
	stress_events: { character: string; intensity: number; cause: string }[];
	relationship_changes: { pair: string; delta: number; cause: string }[];
	key_events: string[];
}

export class StateExtractor {
	private previousState: any = null;
	private turnHistory: TurnResult[] = [];

	async extract(
		storyText: string,
		currentState: any,
		turnResult?: Partial<TurnResult>,
	): Promise<StateUpdate> {
		try {
			const languageModel = await getNovelLanguageModel();

			const evaluation = await this.evaluateTurn(
				storyText,
				currentState,
				turnResult,
			);

			const systemPrompt = this.buildSystemPrompt(currentState, evaluation);

			const result = await generateText({
				model: languageModel,
				system: systemPrompt,
				prompt: `Story segment to analyze:\n\n${storyText}`,
			});

			const text = result.text.trim();
			console.log("   [DEBUG] LLM output:", text.slice(0, 300))
			
			const jsonMatch = text.match(/\{[\s\S]*\}/);

			if (jsonMatch) {
				try {
					const updates = JSON.parse(jsonMatch[0]);
					console.log("   [DEBUG] Parsed keys:", Object.keys(updates))
					const validated = await this.validateAndEnhance(
						updates,
						currentState,
						storyText,
						evaluation,
					);
					log.info("state_extracted", {
						outcome: evaluation.outcome_type,
						difficulty: evaluation.challenge_difficulty,
						characters: Object.keys(validated.characters || {}).length,
						relationships: Object.keys(validated.relationships || {}).length,
						newTraumas: validated.evolution_summary?.changes.newTraumas || 0,
						newSkills: validated.evolution_summary?.changes.newSkills || 0,
						auditFlags: (validated.evolution_summary?.auditFlags || []).length,
					});

					this.previousState = currentState;
					return validated;
				} catch (parseError) {
					log.error("json_parse_failed", { error: String(parseError), json: jsonMatch[0].slice(0, 200) })
				}
			} else {
				log.warn("no_json_found_in_output", { text: text.slice(0, 300) })
			}

			// Fallback: extract state directly from story text using simple pattern matching
			console.log("   [DEBUG] Using fallback state extraction...")
			const fallbackUpdates = this.extractStateFromText(storyText, currentState, evaluation)
			if (fallbackUpdates && Object.keys(fallbackUpdates).length > 0) {
				console.log("   [DEBUG] Fallback extracted:", JSON.stringify(fallbackUpdates).slice(0, 200))
				return fallbackUpdates
			}
		} catch (error) {
			log.error("state_extraction_failed", { error: String(error) });
		}

		return {};
	}

	/**
	 * Fallback: Extract state directly from story text using simple pattern matching
	 */
	private extractStateFromText(storyText: string, currentState: any, evaluation: TurnEvaluation): StateUpdate {
		const updates: StateUpdate = { characters: {}, world: {} }
		
		// Extract characters mentioned in the story
		const characterNames = Object.keys(currentState.characters || {})
		
		for (const charName of characterNames) {
			if (storyText.includes(charName)) {
				let stressDelta = 0
				
				// Check for stress-inducing events
				if (storyText.includes("疼痛") || storyText.includes("剧痛") || storyText.includes("受伤")) {
					stressDelta += 15
				}
				if (storyText.includes("奔跑") || storyText.includes("逃跑") || storyText.includes("追逐")) {
					stressDelta += 10
				}
				if (storyText.includes("绝望") || storyText.includes("恐惧") || storyText.includes("害怕")) {
					stressDelta += 10
				}
				if (storyText.includes("紧张") || storyText.includes("焦虑") || storyText.includes("担心")) {
					stressDelta += 5
				}
				if (storyText.includes("冷静") || storyText.includes("放松") || storyText.includes("喘息")) {
					stressDelta -= 5
				}
				
				// Check for skill acquisition
				let newSkill = null
				if (storyText.includes("解码") || storyText.includes("破解") || storyText.includes("黑客")) {
					newSkill = {
						name: "Quick_Hack_Extraction",
						category: "Technical_Hacking",
						level: 1,
						description: "Emergency hacking in high-pressure situation",
						source_event: "Survival in dangerous environment",
						difficulty: evaluation.challenge_difficulty || 5
					}
				}
				
				// Check for trauma
				let newTrauma = null
				if (stressDelta > 20) {
					newTrauma = {
						name: "Acute_Stress_Reaction",
						description: "High-stress survival situation",
						tags: ["Psychological_Fear"],
						severity: Math.min(10, Math.floor(stressDelta / 5)),
						source_event: "Life-threatening chase"
					}
				}
				
				updates.characters![charName] = {
					stress: stressDelta,
					status: stressDelta > 50 ? "stressed" : "active",
					...(newTrauma && { trauma: [newTrauma] }),
					...(newSkill && { skills: [newSkill] })
				}
			}
		}
		
		// Extract world events
		const events: string[] = []
		if (storyText.includes("无人机")) events.push("无人机追击")
		if (storyText.includes("污水") || storyText.includes("洪水")) events.push("洪水")
		if (storyText.includes("神经")) events.push("神经接口过载")
		if (storyText.includes("数据") || storyText.includes("记忆")) events.push("数据读取")
		
		if (events.length > 0) {
			updates.world = { events }
		}
		
		return updates
	}

	private async evaluateTurn(
		storyText: string,
		currentState: any,
		turnResult?: Partial<TurnResult>,
	): Promise<TurnEvaluation> {
		const languageModel = await getNovelLanguageModel();

		const evaluationPrompt = `You are a strict narrative auditor. Evaluate this turn's outcome.

ANALYSIS RULES:
1. SUCCESS: Character achieved their goal despite obstacles
2. COMPLICATION: Character failed or made situation worse
3. FAILURE: Character suffered clear defeat or setback
4. NEUTRAL: No clear success or failure, just progression

STRESS EVALUATION:
- Identify moments of conflict, danger, psychological pressure
- Rate intensity 1-10 for each character
- High intensity (>7) should trigger trauma consideration

RELATIONSHIP EVALUATION:
- Track trust changes based on cooperation/betrayal
- Range: -50 to +50 per event

Output JSON only:
{
  "outcome_type": "SUCCESS" | "COMPLICATION" | "FAILURE" | "NEUTRAL",
  "challenge_difficulty": 1-10,
  "stress_events": [{"character": "Name", "intensity": 1-10, "cause": "event"}],
  "relationship_changes": [{"pair": "Char1-Char2", "delta": -50 to 50, "cause": "event"}],
  "key_events": ["event1", "event2"]
}`;

		const evalResult = await generateText({
			model: languageModel,
			system: evaluationPrompt,
			prompt: `Current state:\n${JSON.stringify(currentState, null, 2)}\n\nStory:\n${storyText}`,
		});

		const evalJson = evalResult.text.match(/\{[\s\S]*\}/)?.[0];
		if (evalJson) {
			return JSON.parse(evalJson) as TurnEvaluation;
		}

		return {
			outcome_type: turnResult?.outcome_type || "NEUTRAL",
			challenge_difficulty: turnResult?.challenge_difficulty || 5,
			stress_events: [],
			relationship_changes: [],
			key_events: [],
		};
	}

	private buildSystemPrompt(
		currentState: any,
		evaluation: TurnEvaluation,
	): string {
		const { outcome_type, challenge_difficulty, stress_events } = evaluation;

		return buildStateExtractionPrompt({
			currentStateJson: JSON.stringify(currentState, null, 2),
			narrativeText: "Story segment provided separately",
			chaosOutcome: outcome_type,
			difficultyRating: challenge_difficulty,
		});
	}

	private async validateAndEnhance(
		updates: any,
		currentState: any,
		storyText: string,
		evaluation: TurnEvaluation,
	): Promise<StateUpdate> {
		let validated: StateUpdate = { ...updates };
		const auditFlags: any[] = [];
		let correctionsApplied = 0;

		const { outcome_type, challenge_difficulty, stress_events } = evaluation;

		// 🔧 FIX: Transform character_updates array to characters object
		// The prompt outputs array format, but code expects object format
		if (updates.character_updates && Array.isArray(updates.character_updates)) {
			validated.characters = {};
			for (const entry of updates.character_updates) {
				if (entry.name) {
					const charName = entry.name;
					const charObj: any = {
						stress: entry.stress_delta || 0,
						status: entry.status_change || "active",
					};

					if (entry.emotions) {
						charObj.emotions = {
							valence: entry.emotions.valence_delta || 0,
							arousal: entry.emotions.arousal_delta || 50,
							dominant: entry.emotions.dominant || "neutral",
						};
					}

					if (entry.new_trait) {
						charObj.traits = [entry.new_trait];
					}

					// Store trauma/skill data for applyUpdates to handle
					if (entry.new_trauma) {
						charObj.trauma = [
							{
								name: entry.new_trauma.name,
								description: entry.new_trauma.description,
								tags: entry.new_trauma.tags || [],
								severity: entry.new_trauma.severity || 5,
								source_event: entry.new_trauma.source_event,
							},
						];
					}

					if (entry.new_skill) {
						charObj.skills = [
							{
								name: entry.new_skill.name,
								category: entry.new_skill.category || "uncategorized",
								level: entry.new_skill.level || 1,
								description: entry.new_skill.description || "",
								source_event: entry.new_skill.source_event,
								difficulty: entry.new_skill.difficulty || 5,
							},
						];
					}

					validated.characters[charName] = charObj;
				}
			}
			log.info("transformed_character_updates", {
				count: Object.keys(validated.characters).length,
			});
		}

		// Handle relationship_deltas array to relationships object
		if (updates.character_updates) {
			for (const entry of updates.character_updates) {
				if (entry.relationship_deltas && validated.characters && entry.name) {
					const charName = entry.name;
					if (!validated.characters[charName]) {
						validated.characters[charName] = {};
					}
					if (!validated.characters[charName].relationships) {
						validated.characters[charName].relationships = {};
					}
					for (const [otherChar, delta] of Object.entries(
						entry.relationship_deltas,
					)) {
						validated.characters[charName].relationships![otherChar] = {
							trust: delta as number,
							hostility: 0,
							dominance: 0,
							friendliness: 0,
							attachmentStyle: "secure",
						};
					}
				}
			}
		}

		// Transform world_updates if needed
		if (updates.world_updates) {
			validated.world = {
				events: updates.world_updates.events_resolved || [],
				threats: updates.world_updates.new_threats || [],
				opportunities: updates.world_updates.new_opportunities || [],
				activeClues: updates.world_updates.clues_discovered || [],
				location: updates.world_updates.location_change || undefined,
			};
		}

		for (const [charName, charUpdate] of Object.entries(
			validated.characters || {},
		)) {
			const update = charUpdate as CharacterUpdate;
			const currentChar = currentState.characters?.[charName] || {};

			if (update.newSkill) {
				const canAwardSkill = validateSkillAward(
					outcome_type,
					challenge_difficulty,
				);
				if (!canAwardSkill) {
					auditFlags.push({
						type: "SKILL_IN_FAILURE",
						description: `${charName} gained skill during ${outcome_type} (difficulty ${challenge_difficulty})`,
						corrected: true,
						correction: "Skill removed, converted to stress +15",
					});
					delete (update as any).newSkill;
					update.stress = (update.stress || 0) + 15;
					correctionsApplied++;
				} else {
					update.newSkill.difficulty = challenge_difficulty;
					update.newSkill.source_event =
						evaluation.key_events[0] || "Unknown challenge";
				}
			}

			const stressDelta = update.stress || 0;
			const currentStress = currentChar.stress || 0;
			const newStress = currentStress + stressDelta;

			const relatedStressEvent = stress_events.find(
				(e) => e.character === charName,
			);
			const shouldAddTrauma =
				validateTraumaSeverity(
					newStress,
					relatedStressEvent ? relatedStressEvent.intensity >= 7 : false,
				) || stressDelta > 20;

			if (shouldAddTrauma && !update.newTrauma) {
				auditFlags.push({
					type: "MISSING_TRAUMA",
					description: `${charName} experienced stress ${newStress} without trauma`,
					corrected: true,
					correction: "Auto-generated trauma entry",
				});
				update.newTrauma = {
					name: this.generateTraumaName(
						charName,
						relatedStressEvent?.cause || "stress_event",
					),
					description: `Psychological wound from: ${relatedStressEvent?.cause || "high stress event"}`,
					tags: this.selectTraumaTags(relatedStressEvent?.cause || ""),
					severity: Math.min(
						10,
						Math.floor((relatedStressEvent?.intensity || 5) / 2) + 1,
					),
					source_event: relatedStressEvent?.cause || "Cumulative stress",
				};
				correctionsApplied++;
			}

			if (newStress > 90) {
				auditFlags.push({
					type: "STRESS_OVERFLOW",
					description: `${charName} stress ${newStress} exceeds critical threshold`,
					corrected: false,
				});
			}

			if (update.newSkill && update.newSkill.category === "Mental_Analysis") {
				const recentAnalysisSkills = (currentChar.skills || []).filter(
					(s: SkillEntry) =>
						s.category === "Mental_Analysis" &&
						s.acquiredTurn &&
						(currentState.turnCount || 0) - s.acquiredTurn! < 3,
				);
				if (recentAnalysisSkills.length >= 2) {
					auditFlags.push({
						type: "INFLATION",
						description: `${charName} has ${recentAnalysisSkills.length} recent Mental_Analysis skills`,
						corrected: true,
						correction: "Skill merged into existing",
					});
					delete (update as any).newSkill;
					correctionsApplied++;
				}
			}
		}

		for (const [relKey, relUpdate] of Object.entries(
			updates.relationships || {},
		)) {
			const trustDelta = (relUpdate as RelationshipUpdate).trust || 0;
			if (Math.abs(trustDelta) > 50) {
				const hasDramaticEvent = [
					"betray",
					"save",
					"reveal",
					"confess",
					"attack",
					"die",
				].some((word) => storyText.toLowerCase().includes(word));
				if (!hasDramaticEvent) {
					auditFlags.push({
						type: "IMPOSSIBLE_CHANGE",
						description: `Trust shift ${trustDelta} in ${relKey} without dramatic catalyst`,
						corrected: true,
						correction: "Clamped to ±50",
					});
					(relUpdate as RelationshipUpdate).trust = Math.sign(trustDelta) * 50;
					correctionsApplied++;
				}
			}
		}

		if (!validated.evolution_summary) {
			const summary = this.generateEvolutionSummary(
				updates,
				currentState,
				auditFlags,
			);
			validated.evolution_summary = summary as any;
		} else {
			validated.evolution_summary.auditFlags = auditFlags as any;
			validated.evolution_summary.changes.newTraumas = Object.values(
				updates.characters || {},
			).filter((c: any) => c.newTrauma).length;
			validated.evolution_summary.changes.newSkills = Object.values(
				updates.characters || {},
			).filter((c: any) => c.newSkill).length;
		}

		log.info("validation_complete", {
			auditFlags: auditFlags.length,
			correctionsApplied,
			outcome: outcome_type,
		});

		return validated;
	}

	private generateTraumaName(character: string, cause: string): string {
		const keywords = cause
			.split("_")
			.map((k) => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase());
		const suffix = ["Shock", "Wound", "Scar", "Phobia", "PTSD"][
			Math.floor(Math.random() * 5)
		];
		return `${character}_${keywords.join("")}_${suffix}`;
	}

	private selectTraumaTags(cause: string): string[] {
		const tags: string[] = [];
		const causeLower = cause.toLowerCase();

		if (causeLower.includes("interrogat") || causeLower.includes("torture")) {
			tags.push(TRAUMA_TAGS.PSYCHOLOGICAL_FEAR, TRAUMA_TAGS.ISOLATION);
		}
		if (causeLower.includes("combat") || causeLower.includes("injur")) {
			tags.push(TRAUMA_TAGS.PHYSICAL_INJURY, TRAUMA_TAGS.PHYSICAL_PAIN);
		}
		if (causeLower.includes("betray") || causeLower.includes("trust")) {
			tags.push(TRAUMA_TAGS.PSYCHOLOGICAL_BETRAYAL);
		}
		if (causeLower.includes("death") || causeLower.includes("loss")) {
			tags.push(TRAUMA_TAGS.PSYCHOLOGICAL_LOSS);
		}
		if (causeLower.includes("visual") || causeLower.includes("gore")) {
			tags.push(TRAUMA_TAGS.VISUAL, TRAUMA_TAGS.FLASHBACK);
		}
		if (causeLower.includes("nightmare") || causeLower.includes("sleep")) {
			tags.push(TRAUMA_TAGS.NIGHTMARE);
		}

		return tags.length > 0 ? tags : [TRAUMA_TAGS.PSYCHOLOGICAL_FEAR];
	}

	private generateEvolutionSummary(
		updates: any,
		currentState: any,
		auditFlags: any[],
	): EvolutionSummary {
		const chars = updates.characters || {};
		const rels = updates.relationships || {};

		const stressChanges: {
			character: string;
			delta: number;
			cause?: string;
		}[] = [];
		const updatedCharacters: string[] = [];
		const updatedRelationships: string[] = [];
		let newTraumas = 0;
		let newSkills = 0;

		for (const [name, update] of Object.entries(chars)) {
			const u = update as CharacterUpdate;
			updatedCharacters.push(name);
			if (typeof u.stress === "number")
				stressChanges.push({ character: name, delta: u.stress });
			if (u.newTrauma) newTraumas++;
			if (u.newSkill) newSkills++;
		}

		for (const [key] of Object.entries(rels)) {
			updatedRelationships.push(key);
		}

		const highlights: string[] = [];
		if (newTraumas > 0) highlights.push(`${newTraumas} new trauma(s) recorded`);
		if (newSkills > 0) highlights.push(`${newSkills} new skill(s) unlocked`);
		if (stressChanges.some((s) => s.delta > 20))
			highlights.push("Severe stress experienced");

		return {
			timestamp: Date.now(),
			chapter: (currentState.chapterCount || 0) + 1,
			turn: (currentState.turnCount || 0) + 1,
			changes: {
				newCharacters: Object.keys(chars).filter(
					(n) => !currentState.characters?.[n],
				).length,
				updatedCharacters,
				newRelationships: Object.keys(rels).filter(
					(k) => !currentState.relationships?.[k],
				).length,
				updatedRelationships,
				newEvents: ((updates.world as WorldUpdate | undefined)?.events || [])
					.length,
				newTraumas,
				newSkills,
				stressChanges,
			},
			highlights,
			contradictions: [],
			auditFlags,
		};
	}

	applyUpdates(currentState: any, updates: StateUpdate): any {
		const newState = { ...currentState };
		newState.characters = { ...currentState.characters };
		newState.relationships = { ...currentState.relationships };
		newState.world = { ...currentState.world };

		if (updates.characters) {
			for (const [charName, charUpdate] of Object.entries(updates.characters)) {
				if (!newState.characters[charName]) {
					newState.characters[charName] = {
						status: CHARACTER_STATUS.ACTIVE,
						stress: 0,
						emotions: { valence: 0, arousal: 50, dominant: "neutral" },
						traits: [],
						trauma: [],
						skills: [],
						secrets: [],
						clues: [],
						goals: [],
						notes: "",
						relationships: {},
					};
				}

				const current = newState.characters[charName];
				const update = charUpdate as CharacterUpdate;

				if (update.traits && update.traits.length > 0) {
					current.traits = [...new Set([...current.traits, ...update.traits])];
				}

				if (typeof update.stress === "number") {
					current.stress = Math.min(
						100,
						Math.max(0, current.stress + update.stress),
					);
				}

				if (update.emotions) {
					current.emotions = {
						valence:
							update.emotions.valence !== undefined
								? update.emotions.valence
								: current.emotions?.valence || 0,
						arousal:
							update.emotions.arousal !== undefined
								? update.emotions.arousal
								: current.emotions?.arousal || 50,
						dominant:
							update.emotions.dominant ||
							current.emotions?.dominant ||
							"neutral",
					};
				}

				if (update.status) {
					current.status = update.status;
				}

				if (update.newTrauma) {
					current.trauma = [
						...current.trauma,
						{
							name: update.newTrauma.name,
							description: update.newTrauma.description,
							tags: update.newTrauma.tags || [],
							severity: update.newTrauma.severity || 5,
							source_event: update.newTrauma.source_event || "Unknown",
							acquiredChapter: newState.chapterCount,
							acquiredTurn: newState.turnCount,
							triggers: [],
						},
					];
				}

				if (update.newSkill) {
					current.skills = [
						...current.skills,
						{
							name: update.newSkill.name,
							category: update.newSkill.category || "uncategorized",
							level: update.newSkill.level || 1,
							description: update.newSkill.description || "",
							source_event: update.newSkill.source_event || "Unknown",
							difficulty: update.newSkill.difficulty || 5,
							acquiredChapter: newState.chapterCount,
							acquiredTurn: newState.turnCount,
						},
					];
				}

				if (update.secrets && update.secrets.length > 0) {
					current.secrets = [
						...new Set([...current.secrets, ...update.secrets]),
					];
				}

				if (update.clues && update.clues.length > 0) {
					current.clues = [...new Set([...current.clues, ...update.clues])];
				}

				if (update.goals && update.goals.length > 0) {
					for (const goal of update.goals) {
						const existingIndex = current.goals?.findIndex(
							(g: any) => g.type === goal.type,
						);
						if (existingIndex >= 0) {
							current.goals[existingIndex] = goal;
						} else {
							current.goals = [...(current.goals || []), goal];
						}
					}
				}

				if (update.relationships) {
					if (!current.relationships) current.relationships = {};
					for (const [otherChar, delta] of Object.entries(
						update.relationships,
					)) {
						if (!current.relationships[otherChar]) {
							current.relationships[otherChar] = {
								trust: 0,
								hostility: 0,
								dominance: 0,
								friendliness: 0,
								attachmentStyle: "secure",
							};
						}
						current.relationships[otherChar].trust = Math.min(
							100,
							Math.max(
								-100,
								current.relationships[otherChar].trust + (delta as number),
							),
						);
					}
				}

				if (update.notes) {
					current.notes = update.notes;
				}
			}
		}

		if (updates.relationships) {
			for (const [relKey, relUpdate] of Object.entries(updates.relationships)) {
				if (!newState.relationships[relKey]) {
					newState.relationships[relKey] = {
						trust: 0,
						hostility: 0,
						dominance: 0,
						friendliness: 0,
						dynamic: "",
						attachmentStyle: "secure",
						history: [],
					};
				}

				const current = newState.relationships[relKey];
				const update = relUpdate as RelationshipUpdate;

				if (typeof update.trust === "number") {
					const newTrust = Math.min(
						100,
						Math.max(-100, current.trust + update.trust),
					);
					const delta = newTrust - current.trust;
					current.trust = newTrust;
					current.history = [
						...current.history,
						{
							timestamp: Date.now(),
							chapter: newState.chapterCount,
							turn: newState.turnCount,
							previous: current.dynamic || "",
							current: current.dynamic || "",
							delta,
						},
					];
				}

				if (typeof update.hostility === "number") {
					current.hostility = Math.min(
						100,
						Math.max(0, current.hostility + update.hostility),
					);
				}

				if (typeof update.dominance === "number") {
					current.dominance = update.dominance;
				}

				if (typeof update.friendliness === "number") {
					current.friendliness = update.friendliness;
				}

				if (update.dynamic) {
					current.dynamic = update.dynamic;
				}

				if (update.attachmentStyle) {
					current.attachmentStyle = update.attachmentStyle;
				}
			}
		}

		if (updates.world) {
			if (!newState.world) newState.world = {};
			const worldUpdate = updates.world as WorldUpdate;

			if (worldUpdate.events) {
				newState.world.events = [
					...new Set([...(newState.world.events || []), ...worldUpdate.events]),
				];
			}
			if (worldUpdate.timeProgression) {
				newState.world.timeProgression = worldUpdate.timeProgression;
			}
			if (worldUpdate.location) {
				newState.world.location = worldUpdate.location;
			}
			if (worldUpdate.threats) {
				newState.world.threats = [
					...new Set([
						...(newState.world.threats || []),
						...worldUpdate.threats,
					]),
				];
			}
			if (worldUpdate.opportunities) {
				newState.world.opportunities = [
					...new Set([
						...(newState.world.opportunities || []),
						...worldUpdate.opportunities,
					]),
				];
			}
			if (worldUpdate.activeClues) {
				newState.world.activeClues = [
					...new Set([
						...(newState.world.activeClues || []),
						...worldUpdate.activeClues,
					]),
				];
			}
		}

		if (updates.evolution_summary) {
			newState.last_turn_evolution = updates.evolution_summary;
		}

		newState.turnCount = (newState.turnCount || 0) + 1;

		log.info("state_updated", {
			characters: Object.keys(newState.characters).length,
			relationships: Object.keys(newState.relationships).length,
			turnCount: newState.turnCount,
		});

		return newState;
	}

	generateContextString(state: any): string {
		const parts: string[] = [];

		if (state.characters && Object.keys(state.characters).length > 0) {
			parts.push("=== Characters ===");
			for (const [name, char] of Object.entries(state.characters)) {
				const c = char as CharacterState;
				parts.push(`${name} (${c.status || "active"}):`);
				if (c.emotions)
					parts.push(
						`  Emotions: ${c.emotions.dominant} (valence: ${c.emotions.valence}, arousal: ${c.emotions.arousal})`,
					);
				if (c.stress) parts.push(`  Stress: ${c.stress}/100`);
				if (c.traits?.length) parts.push(`  Traits: ${c.traits.join(", ")}`);
				if (c.trauma?.length) {
					for (const t of c.trauma) {
						parts.push(
							`  Trauma: ${t.name || t.description} [${(t as any).tags?.join(",") || "untagged"}] (severity: ${(t as any).severity})`,
						);
					}
				}
				if (c.skills?.length) {
					for (const s of c.skills) {
						parts.push(
							`  Skill: ${s.name} (${s.category}) Lv.${(s as any).level || 1}`,
						);
					}
				}
				if (c.goals?.length) {
					const activeGoals = c.goals.filter((g: any) => g.status === "active");
					if (activeGoals.length)
						parts.push(`  Active Goals: ${activeGoals.length}`);
				}
			}
		}

		if (state.relationships && Object.keys(state.relationships).length > 0) {
			parts.push("\n=== Relationships ===");
			for (const [key, rel] of Object.entries(state.relationships)) {
				const r = rel as any;
				parts.push(
					`${key}: Trust ${r.trust || 0}, Hostility: ${r.hostility || 0}`,
				);
			}
		}

		if (state.world && Object.keys(state.world).length > 0) {
			parts.push("\n=== World State ===");
			if (state.world.events?.length)
				parts.push(`Events: ${state.world.events.slice(-5).join("; ")}`);
			if (state.world.threats?.length)
				parts.push(`Threats: ${state.world.threats.join(", ")}`);
			if (state.world.activeClues?.length)
				parts.push(`Active Clues: ${state.world.activeClues.join(", ")}`);
		}

		if (state.last_turn_evolution) {
			const evo = state.last_turn_evolution;
			parts.push("\n=== Last Turn Evolution ===");
			if (evo.changes?.updatedCharacters?.length)
				parts.push(
					`Characters Changed: ${evo.changes.updatedCharacters.join(", ")}`,
				);
			if (evo.auditFlags?.length)
				parts.push(
					`! Audit Flags: ${evo.auditFlags.map((f: any) => f.type).join(", ")}`,
				);
		}

		return parts.join("\n");
	}
}

export const stateExtractor = new StateExtractor();
