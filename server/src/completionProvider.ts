import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat,
	Position,
} from 'vscode-languageserver/node';

import { DocumentState } from './documentState';
import { RegistryClient } from './registryClient';

/**
 * Determine completion context from cursor position within the document text.
 */
function getContext(text: string, position: Position): {
	type: 'header_start' | 'cap_urn' | 'media_urn' | 'wiring_source' | 'wiring_target' | 'unknown';
	prefix: string;
} {
	const lines = text.split('\n');
	const line = lines[position.line] || '';
	const lineUpToCursor = line.substring(0, position.character);

	// Find the innermost unclosed bracket
	let bracketDepth = 0;
	let bracketStart = -1;
	for (let i = lineUpToCursor.length - 1; i >= 0; i--) {
		if (lineUpToCursor[i] === ']') bracketDepth++;
		if (lineUpToCursor[i] === '[') {
			if (bracketDepth === 0) {
				bracketStart = i;
				break;
			}
			bracketDepth--;
		}
	}

	if (bracketStart === -1) {
		// Not inside a bracket — check if cursor is right after [
		if (lineUpToCursor.trimEnd().endsWith('[')) {
			return { type: 'header_start', prefix: '' };
		}
		return { type: 'unknown', prefix: '' };
	}

	const insideBracket = lineUpToCursor.substring(bracketStart + 1);

	// Check if we're in a cap URN context (after "cap:")
	if (/cap:/.test(insideBracket)) {
		// Check if we're after in= or out= and expecting a media URN
		const afterEquals = insideBracket.match(/(?:in|out)=([^;"\]]*?)$/);
		if (afterEquals) {
			return { type: 'media_urn', prefix: afterEquals[1] };
		}
		const afterQuotedEquals = insideBracket.match(/(?:in|out)="([^"]*?)$/);
		if (afterQuotedEquals) {
			return { type: 'media_urn', prefix: afterQuotedEquals[1] };
		}
		return { type: 'cap_urn', prefix: insideBracket.trim() };
	}

	// Check if we're in a wiring context (has ->)
	if (insideBracket.includes('->')) {
		const parts = insideBracket.split('->');
		if (parts.length >= 3) {
			// After second arrow — completing target
			return { type: 'wiring_target', prefix: parts[parts.length - 1].trim() };
		}
		if (parts.length === 2) {
			// After first arrow — completing cap alias or LOOP + alias
			return { type: 'wiring_target', prefix: parts[1].trim() };
		}
	}

	// At the start of a bracket — could be header or wiring source
	const trimmed = insideBracket.trim();
	if (trimmed === '' || /^[a-zA-Z_]/.test(trimmed)) {
		// Could be starting a header alias or a wiring source
		return { type: 'header_start', prefix: trimmed };
	}

	if (trimmed.startsWith('(')) {
		return { type: 'wiring_source', prefix: trimmed };
	}

	return { type: 'unknown', prefix: trimmed };
}

/**
 * Provide completion items for the given position.
 */
export async function getCompletions(
	state: DocumentState,
	position: Position,
	text: string,
	registry: RegistryClient
): Promise<CompletionItem[]> {
	const ctx = getContext(text, position);

	switch (ctx.type) {
		case 'header_start':
			return getHeaderStartCompletions(state, ctx.prefix, registry);
		case 'cap_urn':
			return getCapUrnCompletions(ctx.prefix, registry);
		case 'media_urn':
			return getMediaUrnCompletions(ctx.prefix, registry);
		case 'wiring_source':
		case 'wiring_target':
			return getWiringCompletions(state, ctx.prefix);
		default:
			return [];
	}
}

async function getHeaderStartCompletions(
	state: DocumentState,
	prefix: string,
	registry: RegistryClient
): Promise<CompletionItem[]> {
	const items: CompletionItem[] = [];

	// Suggest op= values as alias names from registry
	const ops = await registry.getKnownOps();
	for (const op of ops) {
		if (prefix && !op.startsWith(prefix)) continue;
		items.push({
			label: op,
			kind: CompletionItemKind.Function,
			detail: `Alias for op=${op}`,
			insertTextFormat: InsertTextFormat.PlainText,
		});
	}

	// Also suggest existing node names for wirings
	if (state.nodeMedia) {
		for (const [nodeName] of state.nodeMedia) {
			if (prefix && !nodeName.startsWith(prefix)) continue;
			items.push({
				label: nodeName,
				kind: CompletionItemKind.Variable,
				detail: `Node: ${state.nodeMedia.get(nodeName)?.toString() || 'unknown'}`,
			});
		}
	}

	return items;
}

async function getCapUrnCompletions(
	prefix: string,
	registry: RegistryClient
): Promise<CompletionItem[]> {
	const caps = await registry.fetchCapabilities();
	const items: CompletionItem[] = [];

	for (const cap of caps) {
		if (prefix && !cap.urn.startsWith(prefix)) continue;
		items.push({
			label: cap.urn,
			kind: CompletionItemKind.Value,
			detail: cap.title || undefined,
			documentation: cap.description || undefined,
			insertText: cap.urn,
			insertTextFormat: InsertTextFormat.PlainText,
		});
	}

	return items;
}

async function getMediaUrnCompletions(
	prefix: string,
	registry: RegistryClient
): Promise<CompletionItem[]> {
	const urns = await registry.getKnownMediaUrns();
	const items: CompletionItem[] = [];

	for (const urn of urns) {
		if (prefix && !urn.startsWith(prefix)) continue;
		items.push({
			label: urn,
			kind: CompletionItemKind.TypeParameter,
			insertTextFormat: InsertTextFormat.PlainText,
		});
	}

	return items;
}

function getWiringCompletions(
	state: DocumentState,
	prefix: string
): CompletionItem[] {
	const items: CompletionItem[] = [];

	// Suggest existing node names
	if (state.nodeMedia) {
		for (const [nodeName, mediaUrn] of state.nodeMedia) {
			if (prefix && !nodeName.startsWith(prefix)) continue;
			items.push({
				label: nodeName,
				kind: CompletionItemKind.Variable,
				detail: `Node: ${mediaUrn.toString()}`,
			});
		}
	}

	// Suggest cap aliases
	if (state.aliasMap) {
		for (const [alias, entry] of state.aliasMap) {
			if (prefix && !alias.startsWith(prefix)) continue;
			const opTag = entry.capUrn.getTag('op');
			items.push({
				label: alias,
				kind: CompletionItemKind.Function,
				detail: `Cap: ${opTag || entry.capUrn.toString()}`,
			});
		}
	}

	// Suggest LOOP keyword
	if (!prefix || 'LOOP'.startsWith(prefix)) {
		items.push({
			label: 'LOOP',
			kind: CompletionItemKind.Keyword,
			detail: 'ForEach semantics',
		});
	}

	return items;
}
