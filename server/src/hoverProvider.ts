import { Position, Range } from 'vscode-languageserver/node';
import { DocumentState, TokenInfo } from './documentState';
import { RegistryClient } from './registryClient';

interface HoverResult {
	value: string;
	range?: Range;
}

/**
 * Convert Peggy location (1-based) to LSP Range (0-based).
 */
function peggyToRange(loc: { start: { line: number; column: number }; end: { line: number; column: number } }): Range {
	return Range.create(
		Position.create(loc.start.line - 1, loc.start.column - 1),
		Position.create(loc.end.line - 1, loc.end.column - 1)
	);
}

/**
 * Provide hover information for a position in a .machine document.
 */
export async function getHoverInfo(
	state: DocumentState,
	position: Position,
	registry: RegistryClient
): Promise<HoverResult | null> {
	const token = state.getTokenAt(position.line, position.character);
	if (!token) return null;

	switch (token.type) {
		case 'alias':
			return getAliasHover(token, state, registry);
		case 'node':
			return getNodeHover(token, state, registry);
		case 'capUrn':
			return getCapUrnHover(token, state, registry);
		case 'loop':
			return getLoopHover(token);
		default:
			return null;
	}
}

async function getAliasHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	if (!state.aliasMap) return null;

	const entry = state.aliasMap.get(token.value);
	if (!entry) return null;

	const capUrn = entry.capUrn;
	const opTag = capUrn.getTag('op');
	const inSpec = capUrn.getInSpec();
	const outSpec = capUrn.getOutSpec();

	let markdown = `**${token.value}** (capability alias)\n\n`;
	markdown += `\`\`\`\n${capUrn.toString()}\n\`\`\`\n\n`;
	markdown += `| | |\n|---|---|\n`;
	if (opTag) markdown += `| **op** | \`${opTag}\` |\n`;
	markdown += `| **in** | \`${inSpec}\` |\n`;
	markdown += `| **out** | \`${outSpec}\` |\n`;

	// Try to enrich from registry
	const registryEntry = await registry.lookupCapByUrn(capUrn.toString());
	if (registryEntry) {
		if (registryEntry.title) markdown += `\n**${registryEntry.title}**\n`;
		if (registryEntry.description) markdown += `\n${registryEntry.description}\n`;
	}

	return {
		value: markdown,
		range: peggyToRange(token.location),
	};
}

async function getNodeHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	if (!state.nodeMedia) return null;

	const mediaUrn = state.nodeMedia.get(token.value);
	if (!mediaUrn) return null;

	let markdown = `**${token.value}** (node)\n\n`;
	markdown += `Type: \`${mediaUrn.toString()}\`\n`;

	// Try to get media spec title from registry
	const mediaEntry = await registry.lookupMediaByUrn(mediaUrn.toString());
	if (mediaEntry) {
		if (mediaEntry.title) markdown += `\n**${mediaEntry.title}**\n`;
		if (mediaEntry.description) markdown += `\n${mediaEntry.description}\n`;
	}

	return {
		value: markdown,
		range: peggyToRange(token.location),
	};
}

async function getCapUrnHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	// @ts-nocheck
	const capdag = require('capdag');
	let capUrn;
	try {
		capUrn = capdag.CapUrn.fromString(token.value);
	} catch {
		return { value: `Invalid cap URN: \`${token.value}\`` };
	}

	const opTag = capUrn.getTag('op');
	const inSpec = capUrn.getInSpec();
	const outSpec = capUrn.getOutSpec();

	let markdown = `**Cap URN**\n\n`;
	markdown += `\`\`\`\n${capUrn.toString()}\n\`\`\`\n\n`;
	markdown += `| Component | Value |\n|---|---|\n`;
	if (opTag) markdown += `| **op** | \`${opTag}\` |\n`;
	markdown += `| **in** | \`${inSpec}\` |\n`;
	markdown += `| **out** | \`${outSpec}\` |\n`;

	// Show all other tags
	const tags = capUrn.tags;
	if (tags && typeof tags === 'object') {
		for (const [key, val] of Object.entries(tags)) {
			if (key !== 'op') {
				markdown += `| **${key}** | \`${val}\` |\n`;
			}
		}
	}

	const registryEntry = await registry.lookupCapByUrn(capUrn.toString());
	if (registryEntry) {
		if (registryEntry.title) markdown += `\n**${registryEntry.title}**\n`;
		if (registryEntry.description) markdown += `\n${registryEntry.description}\n`;
	}

	return {
		value: markdown,
		range: peggyToRange(token.location),
	};
}

function getLoopHover(token: TokenInfo): HoverResult {
	return {
		value: '**LOOP** — ForEach semantics\n\nApplies the capability to each item in the input list individually, collecting results into an output list.',
		range: peggyToRange(token.location),
	};
}
