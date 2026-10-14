// @ts-nocheck — capdag is a plain JS package without type declarations
import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat,
	Position,
} from 'vscode-languageserver/node';
import { CapUrn } from 'capdag';

import { DocumentState } from './documentState';
import { RegistryClient } from './registryClient';

type ContextType = 'statement_start' | 'cap_urn' | 'media_urn' | 'step' | 'sources' | 'targets' | 'unknown';

interface CompletionContext {
	type: ContextType;
	/** The word being written. */
	prefix: string;
	/** The step of the wiring, when the line says it. */
	step: string | null;
}

/** The step a wiring on this line names, wherever the cursor is in it. */
function stepOfLine(line: string): string | null {
	const found = line.match(/->\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(\{[^}]*\})?\s*->/);
	return found ? found[1] : null;
}

/**
 * What is being written at the cursor. Both statement forms are read: in a
 * bracketed statement the context starts at its innermost unclosed `[`, in a
 * line-based one at the start of the line.
 */
export function contextAt(text: string, position: Position): CompletionContext {
	const line = text.split('\n')[position.line] || '';
	const upToCursor = line.substring(0, position.character);
	let depth = 0;
	let start = -1;
	for (let i = upToCursor.length - 1; i >= 0; i--) {
		if (upToCursor[i] === ']') depth++;
		if (upToCursor[i] === '[') {
			if (depth === 0) {
				start = i;
				break;
			}
			depth--;
		}
	}
	const inside = start >= 0 ? upToCursor.substring(start + 1) : upToCursor;
	const word = (inside.match(/[A-Za-z0-9_-]*$/) || [''])[0];
	const step = stepOfLine(line);
	if (inside.trim() === '') return { type: 'statement_start', prefix: '', step };

	if (/cap:/.test(inside)) {
		const media = inside.match(/(?:in|out)="?([^;"\]]*)$/);
		if (media) return { type: 'media_urn', prefix: media[1], step };
		return { type: 'cap_urn', prefix: inside.trim(), step };
	}
	const arrows = (inside.match(/->/g) || []).length;
	if (arrows >= 2) return { type: 'targets', prefix: word, step };
	if (arrows === 1) return { type: 'step', prefix: word, step };
	if (/^\s*\(/.test(inside)) return { type: 'sources', prefix: word, step };
	if (/^\s*[A-Za-z_][A-Za-z0-9_-]*$/.test(inside)) return { type: 'statement_start', prefix: word, step };
	return { type: 'unknown', prefix: word, step };
}

/** Completion items for a position. */
export async function getCompletions(
	state: DocumentState,
	position: Position,
	text: string,
	registry: RegistryClient
): Promise<CompletionItem[]> {
	const ctx = contextAt(text, position);
	switch (ctx.type) {
		case 'statement_start':
			return [...nodeItems(state, ctx.prefix), ...stepItems(state, ctx.prefix, await capAliases(registry))];
		case 'step':
			return stepItems(state, ctx.prefix, await capAliases(registry));
		case 'sources':
			return [...await argItems(state, registry, ctx), ...nodeItems(state, ctx.prefix)];
		case 'targets':
			return [...await outputItems(state, registry, ctx), ...nodeItems(state, ctx.prefix)];
		case 'cap_urn':
			return capUrnItems(ctx.prefix, await caps(registry));
		case 'media_urn':
			return mediaUrnItems(ctx.prefix, await caps(registry));
		default:
			return [];
	}
}

/**
 * Every cap of the registry, for completions. A registry that cannot give
 * them leaves the completions it would have offered out; the reason is
 * logged, never hidden as an empty registry.
 */
async function caps(registry: RegistryClient): Promise<any[]> {
	try {
		return await registry.allCaps();
	} catch (error: any) {
		console.error(`[machine-lsp] the registry's caps are not available: ${error.message}`);
		return [];
	}
}

async function capAliases(registry: RegistryClient): Promise<Array<[string, string]>> {
	await caps(registry);
	return registry.definitions.cachedCapAliases();
}

function nodeItems(state: DocumentState, prefix: string): CompletionItem[] {
	if (!state.nodeMedia) return [];
	const items: CompletionItem[] = [];
	for (const [name, media] of state.nodeMedia) {
		if (prefix && !name.startsWith(prefix)) continue;
		items.push({ label: name, kind: CompletionItemKind.Variable, detail: `Node: ${media.toString()}`, sortText: `1_${name}` });
	}
	return items;
}

function stepItems(state: DocumentState, prefix: string, fabricAliases: Array<[string, string]>): CompletionItem[] {
	const items: CompletionItem[] = [];
	const declared = new Set<string>();
	for (const statement of state.statements || []) {
		if (statement.kind === 'wiring') continue;
		declared.add(statement.alias);
		if (prefix && !statement.alias.startsWith(prefix)) continue;
		items.push({
			label: statement.alias,
			kind: CompletionItemKind.Function,
			detail: statement.kind === 'machine_header' ? `Machine: ${statement.reference}` : `Cap: ${statement.capUrn}`,
			sortText: `2_${statement.alias}`,
		});
	}
	for (const [name, target] of fabricAliases) {
		if (declared.has(name) || (prefix && !name.startsWith(prefix))) continue;
		items.push({ label: name, kind: CompletionItemKind.Function, detail: `Fabric alias: ${target}`, sortText: `3_${name}` });
	}
	return items;
}

/** The cap the step of a wiring stands for, fetched: a header's, or the fabric alias's. */
async function capOfStep(state: DocumentState, registry: RegistryClient, step: string | null): Promise<any | null> {
	if (step === null) return null;
	const header = (state.statements || []).find(s => s.kind === 'cap_header' && s.alias === step);
	let urn = header ? header.capUrn : registry.definitions.aliasTarget(step);
	if (!urn) {
		await caps(registry);
		urn = registry.definitions.aliasTarget(step);
	}
	if (!urn || !urn.startsWith('cap:')) return null;
	try {
		return await registry.cap(CapUrn.fromString(urn).toString());
	} catch (_) {
		return null;
	}
}

/** The args of the wiring's step, each as `name=`: a member that says which arg it is for. */
async function argItems(state: DocumentState, registry: RegistryClient, ctx: CompletionContext): Promise<CompletionItem[]> {
	const cap = await capOfStep(state, registry, ctx.step);
	if (!cap) return [];
	return cap.args
		.filter(arg => !ctx.prefix || arg.name.startsWith(ctx.prefix))
		.map(arg => ({
			label: `${arg.name}=`,
			kind: CompletionItemKind.Field,
			detail: `${arg.acceptedUrn()}${arg.is_sequence ? ' (sequence)' : ''}`,
			documentation: arg.arg_description || undefined,
			insertText: `${arg.name}=`,
			insertTextFormat: InsertTextFormat.PlainText,
			sortText: `0_${arg.name}`,
		}));
}

/** The outputs of the wiring's step, each as `name=`: a target that says which output it takes. */
async function outputItems(state: DocumentState, registry: RegistryClient, ctx: CompletionContext): Promise<CompletionItem[]> {
	const cap = await capOfStep(state, registry, ctx.step);
	if (!cap) return [];
	return cap.getOutputs()
		.filter(output => !ctx.prefix || output.name.startsWith(ctx.prefix))
		.map(output => ({
			label: `${output.name}=`,
			kind: CompletionItemKind.Field,
			detail: `${output.media_urn}${output.is_sequence ? ' (sequence)' : ''}${output.optional ? ', may not fire' : ''}`,
			documentation: output.output_description || undefined,
			insertText: `${output.name}=`,
			insertTextFormat: InsertTextFormat.PlainText,
			sortText: `0_${output.name}`,
		}));
}

function capUrnItems(prefix: string, all: any[]): CompletionItem[] {
	return all
		.filter(cap => !prefix || cap.urn.toString().startsWith(prefix))
		.map(cap => ({
			label: cap.urn.toString(),
			kind: CompletionItemKind.Value,
			detail: cap.title,
			documentation: cap.cap_description || undefined,
			insertText: cap.urn.toString(),
			insertTextFormat: InsertTextFormat.PlainText,
		}));
}

function mediaUrnItems(prefix: string, all: any[]): CompletionItem[] {
	const urns = new Set<string>();
	for (const cap of all) {
		urns.add(cap.urn.getInSpec());
		urns.add(cap.urn.getOutSpec());
	}
	return [...urns]
		.filter(urn => !prefix || urn.startsWith(prefix))
		.sort()
		.map(urn => ({ label: urn, kind: CompletionItemKind.TypeParameter, insertTextFormat: InsertTextFormat.PlainText }));
}
