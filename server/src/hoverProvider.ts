// @ts-nocheck — capdag is a plain JS package without type declarations
import { Position, Range } from 'vscode-languageserver/node';
import { DocumentState, TokenInfo } from './documentState';
import { RegistryClient } from './registryClient';
import { rangeOf } from './diagnosticsProvider';
import { CapUrn } from 'capdag';

interface HoverResult {
	value: string;
	range?: Range;
}

/** The cap a step of the document stands for, by its name: a header's, or the fabric alias's. */
function capUrnOfStep(state: DocumentState, registry: RegistryClient, step: string): any | null {
	const header = state.statements?.find(s => s.kind === 'cap_header' && s.alias === step);
	if (header) {
		try {
			return CapUrn.fromString(header.capUrn);
		} catch (_) {
			return null;
		}
	}
	const target = registry.definitions.aliasTarget(step);
	return target !== null && target.startsWith('cap:') ? CapUrn.fromString(target) : null;
}

function capTable(cap: any): string {
	let markdown = '';
	if (cap.args.length > 0) {
		markdown += `\n| Arg | Takes | |\n|---|---|---|\n`;
		for (const arg of cap.args) {
			const role = arg.hasStdinSource() ? 'main input' : (arg.required ? 'required' : 'optional');
			markdown += `| \`${arg.name}\` | \`${arg.acceptedUrn()}\`${arg.is_sequence ? ' (sequence)' : ''} | ${role} |\n`;
		}
	}
	const outputs = cap.getOutputs();
	if (outputs.length > 0) {
		const main = cap.mainOutput();
		markdown += `\n| Output | Gives | |\n|---|---|---|\n`;
		for (const output of outputs) {
			const role = output === main ? 'main' : (output.optional ? 'optional' : 'required');
			markdown += `| \`${output.name}\` | \`${output.media_urn}\`${output.is_sequence ? ' (sequence)' : ''} | ${role} |\n`;
		}
	}
	return markdown;
}

/** Hover text for a position in a .machine document. */
export async function getHoverInfo(
	state: DocumentState,
	position: Position,
	registry: RegistryClient
): Promise<HoverResult | null> {
	const token = state.getTokenAt(position.line, position.character);
	if (!token) return null;
	const range = rangeOf(token.location);
	switch (token.type) {
		case 'alias':
			return withRange(await stepHover(token, state, registry), range);
		case 'capUrn':
			return withRange(await capUrnHover(token.value, registry), range);
		case 'node':
			return withRange(await nodeHover(token, state, registry), range);
		case 'argName':
		case 'constant':
			return withRange(await argHover(token, state, registry), range);
		case 'outputName':
			return withRange(await outputHover(token, state, registry), range);
		case 'policy':
			return { value: `**Policy** \`${token.value}\`\n\nretry: further attempts on a retryable failure; on_error=absent: a lasting failure leaves the step's outputs absent.`, range };
		case 'machineReference':
			return { value: `**Machine** \`${token.value}\`\n\nAnother machine, used as a step: its steps are written into this one.`, range };
		default:
			return null;
	}
}

function withRange(hover: HoverResult | null, range: Range): HoverResult | null {
	return hover === null ? null : { ...hover, range };
}

async function definitionOf(registry: RegistryClient, capUrn: any): Promise<any | null> {
	try {
		return await registry.cap(capUrn.toString());
	} catch (_) {
		return null;
	}
}

async function stepHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	const machineHeader = state.statements?.find(s => s.kind === 'machine_header' && s.alias === token.value);
	if (machineHeader) return { value: `**${token.value}** — the machine \`${machineHeader.reference}\`` };
	const capUrn = capUrnOfStep(state, registry, token.value);
	if (capUrn === null) return null;
	let markdown = `**${token.value}**\n\n\`\`\`\n${capUrn.toString()}\n\`\`\`\n`;
	const cap = await definitionOf(registry, capUrn);
	if (cap) {
		markdown += `\n**${cap.title}**\n`;
		if (cap.cap_description) markdown += `\n${cap.cap_description}\n`;
		markdown += capTable(cap);
	}
	return { value: markdown };
}

async function capUrnHover(text: string, registry: RegistryClient): Promise<HoverResult> {
	let capUrn;
	try {
		capUrn = CapUrn.fromString(text);
	} catch (error: any) {
		return { value: `Invalid cap URN: ${error.message}` };
	}
	let markdown = `**Cap URN**\n\n\`\`\`\n${capUrn.toString()}\n\`\`\`\n`;
	markdown += `\n| | |\n|---|---|\n| **in** | \`${capUrn.getInSpec()}\` |\n| **out** | \`${capUrn.getOutSpec()}\` |\n`;
	const cap = await definitionOf(registry, capUrn);
	if (cap) {
		markdown += `\n**${cap.title}**\n`;
		if (cap.cap_description) markdown += `\n${cap.cap_description}\n`;
		markdown += capTable(cap);
	}
	return { value: markdown };
}

async function nodeHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	const media = state.nodeMedia?.get(token.value);
	if (!media) return { value: `**${token.value}** (node)` };
	let markdown = `**${token.value}** (node)\n\nHolds \`${media.toString()}\`\n`;
	try {
		const def = await registry.mediaDef(media.toString());
		markdown += `\n**${def.title}**\n`;
		if (def.description) markdown += `\n${def.description}\n`;
	} catch (_) {
		// A node of a media the registry does not define is still a node.
	}
	return { value: markdown };
}

async function argHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	const capUrn = token.step ? capUrnOfStep(state, registry, token.step) : null;
	const cap = capUrn ? await definitionOf(registry, capUrn) : null;
	const member = token.statement.wiring.sources.find(m => m.nameLocation === token.location || m.valueLocation === token.location);
	const name = member ? member.name : token.value;
	if (!cap) return { value: `**${name}** — an arg of \`${token.step}\`` };
	const arg = cap.argNamed(name);
	if (!arg) return { value: `\`${token.step}\` declares no arg named \`${name}\`` };
	let markdown = `**${name}** — an arg of **${cap.title}**\n\nTakes \`${arg.acceptedUrn()}\`${arg.is_sequence ? ', a sequence' : ''}; delivered as \`${arg.media_urn}\`\n`;
	if (arg.arg_description) markdown += `\n${arg.arg_description}\n`;
	if (token.type === 'constant') markdown += `\nGiven the constant \`${token.value}\`\n`;
	return { value: markdown };
}

async function outputHover(token: TokenInfo, state: DocumentState, registry: RegistryClient): Promise<HoverResult | null> {
	const capUrn = token.step ? capUrnOfStep(state, registry, token.step) : null;
	const cap = capUrn ? await definitionOf(registry, capUrn) : null;
	if (!cap) return { value: `**${token.value}** — an output of \`${token.step}\`` };
	const output = cap.outputNamed(token.value);
	if (!output) return { value: `\`${token.step}\` declares no output named \`${token.value}\`` };
	let markdown = `**${token.value}** — an output of **${cap.title}**\n\nGives \`${output.media_urn}\`${output.is_sequence ? ', a sequence' : ''}${output.optional ? '; it may not fire' : ''}\n`;
	if (output.output_description) markdown += `\n${output.output_description}\n`;
	return { value: markdown };
}
