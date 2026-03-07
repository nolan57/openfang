#!/usr/bin/env bun
/**
 * State Calibration Script
 *
 * Purpose: Fix historical debt from 10 turns of buggy state extraction
 *
 * This script:
 * 1. Reads the existing story_bible.json and fullStory text
 * 2. Uses STATE_CALIBRATION_PROMPT to analyze and generate corrected state via LLM
 * 3. Backs up the original and writes the calibrated state
 *
 * Usage: bun run scripts/calibrate-state.ts
 */

import { write, file } from "bun";
import { resolve, dirname } from "path";
import { generateText } from "ai";
import { Provider } from "../src/provider/provider";
import { STATE_CALIBRATION_PROMPT } from "../src/prompts/system-prompts";
import { Instance } from "../src/project/instance";

const NOVEL_PROJECT_DIR = resolve("/Users/lpcw/Documents/opencode/.opencode/novel");

interface StoryBible {
	characters: Record<string, any>;
	world: Record<string, any>;
	relationships: Record<string, any>;
	currentChapter: string;
	chapterCount: number;
	turnCount?: number;
	fullStory: string;
	timestamps?: Record<string, number>;
	metadata?: Record<string, any>;
	[key: string]: any;
}

interface CalibratedState {
	characters: Record<string, any>;
	relationships: Record<string, any>;
	world: Record<string, any>;
	calibration_notes: string[];
}

async function loadStoryBible(path: string): Promise<StoryBible> {
	const content = await file(path).text();
	return JSON.parse(content);
}

async function calibrateStateWithLLM(
	fullStory: string,
	chapterCount: number,
): Promise<CalibratedState> {
	const model = await Provider.defaultModel();
	const modelInfo = await Provider.getModel(model.providerID, model.modelID);
	const languageModel = await Provider.getLanguage(modelInfo);

	// Build the calibration prompt with actual data
	const prompt = `
${STATE_CALIBRATION_PROMPT}

=== INPUT DATA ===

CHAPTER_COUNT: ${chapterCount}

FULL STORY TEXT (Turns 1-${chapterCount}):
"""
${fullStory}
"""

=== INSTRUCTION ===

Analyze the above story text and generate a CORRECTED state snapshot.
Be HARSH - prune generic skills, add realistic stress, generate trauma for high-pressure events.
Output ONLY the JSON calibration result.
`;

	const result = await generateText({
		model: languageModel,
		system: "You are a forensic narrative analyst. Output ONLY valid JSON.",
		prompt: prompt,
	});

	// Extract JSON from response
	const jsonMatch = result.text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("Failed to parse calibration result as JSON");
	}

	const calibratedState = JSON.parse(jsonMatch[0]) as CalibratedState;

	return calibratedState;
}

async function mergeCalibratedState(
	original: StoryBible,
	calibrated: CalibratedState,
): Promise<StoryBible> {
	// Preserve original structure but update with calibrated data
	const merged: StoryBible = {
		...original,
		characters: {},
		relationships: calibrated.relationships || {},
		world: {
			...original.world,
			...calibrated.world,
		},
		timestamps: {
			...original.timestamps,
			lastCalibration: Date.now(),
		},
		metadata: {
			...original.metadata,
			calibrationVersion: "2.0.0",
			calibrationMethod: "LLM-assisted with STATE_CALIBRATION_PROMPT",
			calibrationNotes: calibrated.calibration_notes || [],
		},
	};

	// Merge characters - preserve original fields but update with calibrated values
	for (const [charName, originalChar] of Object.entries(original.characters)) {
		const calibratedChar = calibrated.characters?.[charName];

		if (calibratedChar) {
			merged.characters[charName] = {
				// Calibrated values (stress, trauma, skills, emotions)
				stress: calibratedChar.stress ?? originalChar.stress ?? 0,
				status: calibratedChar.status ?? originalChar.status ?? "active",
				emotions: calibratedChar.emotions ?? {
					valence: 0,
					arousal: 50,
					dominant: "neutral",
				},
				trauma: calibratedChar.trauma ?? [],
				skills: calibratedChar.skills ?? [],
				goals: calibratedChar.goals ?? originalChar.goals ?? [],
				secrets: originalChar.secrets ?? [],
				clues: originalChar.clues ?? [],
				notes: calibratedChar.notes ?? originalChar.notes ?? "",
				relationships: originalChar.relationships ?? {},
			};
		} else {
			// Character not in calibration - preserve original but flag
			merged.characters[charName] = {
				...originalChar,
				notes: (originalChar.notes || "") + " [NOT_CALIBRATED]",
			};
		}
	}

	// Add new characters from calibration
	for (const [charName, calibratedChar] of Object.entries(
		calibrated.characters,
	)) {
		if (!merged.characters[charName]) {
			merged.characters[charName] = calibratedChar;
		}
	}

	return merged;
}

async function main(): Promise<void> {
	const statePath = resolve(
		"/Users/lpcw/Documents/opencode/.opencode/novel/state/story_bible.json",
	);
	const backupPath = resolve(
		"/Users/lpcw/Documents/opencode/.opencode/novel/state/story_bible.backup.json",
	);

	console.log("=".repeat(60));
	console.log("🔧 NOVEL STATE CALIBRATION");
	console.log("Using STATE_CALIBRATION_PROMPT (LLM-assisted)");
	console.log("=".repeat(60));

	// Load existing state
	console.log("\n📖 Loading story_bible.json...");
	const originalBible = await loadStoryBible(statePath);
	console.log(`   Chapters: ${originalBible.chapterCount}`);
	console.log(`   Characters: ${Object.keys(originalBible.characters).length}`);
	console.log(`   Story length: ${originalBible.fullStory?.length || 0} chars`);

	// Create backup
	console.log("\n💾 Creating backup...");
	await write(backupPath, JSON.stringify(originalBible, null, 2));
	console.log(`   Backup: ${backupPath}`);

	// Run LLM calibration
	console.log("\n🤖 Running LLM calibration analysis...");
	console.log("   This may take 30-60 seconds...");

	const calibratedState = await Instance.provide({
		directory: NOVEL_PROJECT_DIR,
		fn: () =>
			calibrateStateWithLLM(
				originalBible.fullStory || "",
				originalBible.chapterCount,
			),
	});

	console.log("   ✓ Calibration complete");

	if (calibratedState.calibration_notes) {
		console.log("\n📝 Calibration Notes:");
		for (const note of calibratedState.calibration_notes) {
			console.log(`   - ${note}`);
		}
	}

	// Merge states
	console.log("\n🔀 Merging calibrated state...");
	const mergedBible = await mergeCalibratedState(
		originalBible,
		calibratedState,
	);

	// Summary
	console.log("\n" + "=".repeat(60));
	console.log("📊 CALIBRATION SUMMARY");
	console.log("=".repeat(60));

	let totalStress = 0;
	let totalTrauma = 0;
	let totalSkills = 0;

	for (const [name, char] of Object.entries(mergedBible.characters)) {
		const c = char as any;
		totalStress += c.stress || 0;
		totalTrauma += c.trauma?.length || 0;
		totalSkills += c.skills?.length || 0;
		console.log(
			`   ${name}: stress=${c.stress}, trauma=${c.trauma?.length}, skills=${c.skills?.length}`,
		);
	}

	console.log(
		`\n   Average Stress: ${Math.round(totalStress / Object.keys(mergedBible.characters).length)}/100`,
	);
	console.log(`   Total Trauma Entries: ${totalTrauma}`);
	console.log(`   Total Skills (pruned): ${totalSkills}`);
	console.log(
		`   Relationships: ${Object.keys(mergedBible.relationships).length}`,
	);

	// Write calibrated state
	console.log("\n💾 Writing calibrated state...");
	await write(statePath, JSON.stringify(mergedBible, null, 2));
	console.log(`   ✓ Saved: ${statePath}`);

	console.log("\n" + "=".repeat(60));
	console.log("✅ CALIBRATION COMPLETE");
	console.log("=".repeat(60));
	console.log("\n⚠️  NEXT STEPS:");
	console.log("1. Review the calibrated story_bible.json");
	console.log("2. Compare with backup if needed: story_bible.backup.json");
	console.log(
		"3. Continue story generation - new logic will apply going forward",
	);
	console.log("\n📁 Files:");
	console.log(`   Calibrated: ${statePath}`);
	console.log(`   Backup: ${backupPath}`);
	console.log("=".repeat(60));
}

// Run calibration
main().catch((error) => {
	console.error("\n❌ Calibration failed:", error);
	console.error(
		"\n💡 The backup file is still intact. You can retry after fixing the issue.",
	);
	process.exit(1);
});
