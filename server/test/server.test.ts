// @ts-nocheck — capdag is a plain JS package without type declarations
// Tests of the language server's reading of .machine documents against a
// fabric registry: what it fetches, where it places what is wrong, what is
// under the cursor, and what it offers and says there.

import { CapUrn, MediaUrn } from 'capdag';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DocumentState } from '../src/documentState';
import { RegistryClient } from '../src/registryClient';
import { getDiagnostics } from '../src/diagnosticsProvider';
import { getCompletions, contextAt } from '../src/completionProvider';
import { getHoverInfo } from '../src/hoverProvider';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual: any, expected: any, message: string): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) throw new Error(`Assertion failed: ${message}. Expected: ${e}, Actual: ${a}`);
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		passed++;
		console.log(`  PASS ${name}`);
	} catch (error: any) {
		failed++;
		console.log(`  FAIL ${name}: ${error.stack || error.message}`);
	}
}

// ============================================================================
// A fabric registry in memory, served at the locations its charter states.
// ============================================================================

const REGISTRY = 'https://fabric.example';
const PDF = 'media:document;ext=pdf';
const TEXT = 'media:enc=utf-8;ext=txt';
const PAGES = 'media:integer;max-pages';
const VECTOR = 'media:record;vec';
const EXTRACT = CapUrn.fromString(`cap:in="${PDF}";extract;out="${TEXT}"`).toString();
const EMBED = CapUrn.fromString(`cap:in="${TEXT}";embed;out="${VECTOR}"`).toString();

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const canonical = (urn: string) => MediaUrn.fromString(urn).toString();

function capJSON(urn: string, title: string, args: any[], outputs: any[]) {
	return { urn, title, aliases: [title.toLowerCase()], version: 1, args, outputs };
}

/** A registry of two caps, extract and embed, and a fabric alias for embed. */
function fakeFetch(change: (served: any) => void = () => {}) {
	const served: any = {
		caps: {
			[EXTRACT]: capJSON(EXTRACT, 'Extract', [
				{ media_urn: PDF, name: 'document', required: true, sources: [{ stdin: PDF }] },
				{ media_urn: PAGES, name: 'max_pages', required: false, sources: [{ cli_flag: '--max-pages' }], arg_description: 'At most this many pages' },
			], [{ media_urn: TEXT, name: 'text', output_description: 'The text' }]),
			[EMBED]: capJSON(EMBED, 'Embed', [
				{ media_urn: TEXT, name: 'text', required: true, sources: [{ stdin: TEXT }] },
			], [{ media_urn: VECTOR, name: 'vector', output_description: 'The vector' }]),
		},
		media: {
			[canonical(PDF)]: { urn: canonical(PDF), media_type: 'application/pdf', title: 'PDF', version: 1 },
			[canonical(TEXT)]: { urn: canonical(TEXT), media_type: 'text/plain', title: 'Plain Text', version: 1 },
			[canonical(PAGES)]: { urn: canonical(PAGES), media_type: 'application/json', title: 'Page Limit', version: 1, validation: { min: 1 }, schema: { type: 'integer' } },
			[canonical(VECTOR)]: { urn: canonical(VECTOR), media_type: 'application/json', title: 'Vector', version: 1 },
		},
		aliases: { vectorize: { name: 'vectorize', target: EMBED, version: 1 } },
	};
	change(served);
	const objects = new Map<string, any>();
	objects.set(`${REGISTRY}/charter.json`, {
		format: 'machinefabric-registry-charter/1', anchor: REGISTRY, kind: 'fabric', slug: 'test-fabric',
		environment: 'prod', issued_at: 1792800000, not_after: null,
		locations: {
			manifest: `${REGISTRY}/manifest/{manifest_version}.json`,
			latest: `${REGISTRY}/manifest/latest.json`,
			definition: `${REGISTRY}/{kind}/{urn_hash}/{version}.json`,
		},
	});
	objects.set(`${REGISTRY}/manifest/latest.json`, { version: 8 });
	objects.set(`${REGISTRY}/manifest/8.json`, {
		version: 8,
		previous: 7,
		caps: Object.fromEntries(Object.keys(served.caps).map(urn => [urn, 1])),
		media: Object.fromEntries(Object.keys(served.media).map(urn => [urn, 1])),
		aliases: Object.fromEntries(Object.keys(served.aliases).map(name => [name, 1])),
		dims: {},
	});
	for (const [urn, body] of Object.entries(served.caps)) objects.set(`${REGISTRY}/caps/${sha(urn)}/1.json`, body);
	for (const [urn, body] of Object.entries(served.media)) objects.set(`${REGISTRY}/media/${sha(urn)}/1.json`, body);
	for (const [name, body] of Object.entries(served.aliases)) objects.set(`${REGISTRY}/aliases/${sha(name)}/1.json`, body);
	// The charter is asked for with a cache-bust query.
	return async (url: string) => {
		const bare = url.split('?')[0];
		return objects.has(bare)
			? { status: 200, ok: true, json: async () => JSON.parse(JSON.stringify(objects.get(bare))) }
			: { status: 404, ok: false, json: async () => ({}) };
	};
}

const HEADER = `[extract ${EXTRACT}]`;
const registryOf = (change?: (served: any) => void) => RegistryClient.open(REGISTRY, null, fakeFetch(change));
const read = async (text: string, change?: (served: any) => void, file: string | null = null) =>
	DocumentState.read('file:///test.machine', text, await registryOf(change), file);

/** The text a location covers. */
const covered = (text: string, location: any) => text.slice(location.start.offset, location.end.offset);

/** The LSP position of the first occurrence of `needle` (plus `into` characters) in a text. */
function positionOf(text: string, needle: string, into = 0) {
	const at = text.indexOf(needle) + into;
	assert(at >= into, `${needle} is in the text`);
	const before = text.slice(0, at).split('\n');
	return { line: before.length - 1, character: before[before.length - 1].length };
}

// TEST12840: a document is read against the registry: the caps its headers
// name and the fabric aliases its steps use are fetched, and it resolves —
// a step by its fabric alias, a constant held to its media's rules.
async function test12840_aDocumentIsReadAgainstTheRegistry() {
	const text = `${HEADER}\n[(document=doc, max_pages=20) -> extract -> text]\n[text -> vectorize -> vec]`;
	const state = await read(text);
	assertEqual(state.problems, [], 'no problems');
	assert(state.machine !== null, 'a machine');
	assertEqual(state.machine.strands()[0].edges().length, 2, 'two steps, one by its fabric alias');
	assertEqual(state.nodeMedia.get('vec').toString(), canonical(VECTOR), 'the media a node holds');
	assert(state.machine.toMermaid().includes('"max_pages"'), 'the graph names the arg');
	// The registry the settings pin is the one read.
	const pinned = await RegistryClient.open(REGISTRY, 8, fakeFetch());
	assertEqual(pinned.client.manifestVersion, 8, 'a pinned manifest');
}

// TEST12841: what is wrong is placed where the text writes what it is about:
// a syntax error where reading stopped, an arg the cap does not declare at the
// member that names it, a constant its rules refuse at the constant, a step
// that is no header and no alias at the step, and a definition the registry
// could not give at the header that names it.
async function test12841_problemsArePlacedWhereTheyAre() {
	const located = async (text: string, change?: (served: any) => void) => {
		const state = await read(text, change);
		assertEqual(state.problems.length, 1, `one problem in ${text}: ${JSON.stringify(state.problems)}`);
		const problem = state.problems[0];
		assert(problem.location !== null, `${problem.code} is placed: ${problem.message}`);
		return [problem, covered(text, problem.location)];
	};
	let [problem, at] = await located(`${HEADER}\n[(document=doc, pages=3) -> extract -> text]`);
	assertEqual([problem.code, at], ['UnknownArgName', 'pages=3'], 'an unknown arg');
	[problem, at] = await located(`${HEADER}\n[(document=doc, max_pages=0) -> extract -> text]`);
	assertEqual([problem.code, at], ['ConstantFailsValidation', '0'], 'a refused constant');
	[problem, at] = await located(`${HEADER}\n[doc -> extract -> (words=w)]`);
	assertEqual([problem.code, at], ['UnknownOutputName', 'words=w'], 'an unknown output');
	// On a step written by its fabric alias, with no header to say its cap.
	[problem, at] = await located(`[t -> vectorize -> (oops=o)]`);
	assertEqual([problem.code, at], ['UnknownOutputName', 'oops=o'], 'an unknown output of an aliased step');
	[problem, at] = await located(`${HEADER}\n[doc -> nothing -> text]`);
	assertEqual([problem.code, at], ['UndefinedAlias', 'nothing'], 'an undefined step');
	[problem, at] = await located(`${HEADER}\n[doc -> extract -> text`);
	assertEqual(problem.code, 'ParseError', 'a syntax error');
	[problem, at] = await located(`${HEADER}\n[doc -> extract -> text]`, served => { served.caps[EXTRACT].args[1].name = 'max pages'; });
	assertEqual(problem.code, 'Validation', 'a definition that breaks a rule');
	assertEqual(at, EXTRACT, "at the header's URN");
	assert(problem.message.includes('breaks a definition rule'), problem.message);
	// After blank lines, places are where the text puts them.
	const padded = `\n\n${HEADER}\n[(document=doc, pages=3) -> extract -> text]`;
	const state = await read(padded);
	assertEqual(covered(padded, state.problems[0].location), 'pages=3', 'blank lines before the first statement');
	const diagnostic = getDiagnostics(state)[0];
	assertEqual(diagnostic.range.start, { line: 3, character: 16 }, 'as an LSP range');
}

// TEST12842: the token under the cursor is what that part of a wiring is: the
// arg a member names, its node or its constant, the step, the policy, the
// output a target names and its node.
async function test12842_theTokenUnderTheCursor() {
	const text = `${HEADER}\n[(document=doc, max_pages=20) -> extract{retry=2} -> (text=t)]`;
	const state = await read(text);
	const token = (needle: string, into = 0) => {
		const at = positionOf(text.slice(HEADER.length), needle, into);
		const found = state.getTokenAt(at.line, at.character);
		return found ? [found.type, found.value, found.step || null] : null;
	};
	assertEqual(token('document'), ['argName', 'document', 'extract'], 'an arg name');
	assertEqual(token('doc,'), ['node', 'doc', null], 'a node');
	assertEqual(token('20'), ['constant', '20', 'extract'], 'a constant');
	assertEqual(token('extract{', 2), ['alias', 'extract', null], 'the step');
	assertEqual(token('{retry', 1), ['policy', '{retry=2}', 'extract'], 'the policy');
	assertEqual(token('text=t', 1), ['outputName', 'text', 'extract'], 'an output name');
	assertEqual(token('=t)', 1), ['node', 't', null], 'a target node');
	const header = state.getTokenAt(0, 2);
	assertEqual([header.type, header.value], ['alias', 'extract'], "a header's alias");
}

// TEST12843: completions offer, in a wiring's source group, the args of its
// step as `name=`; in its targets, the step's outputs; in step position, the
// header and fabric aliases.
async function test12843_completionsOfferNamesOfTheStep() {
	const text = `${HEADER}\n[(document=doc, ) -> extract -> (text=t)]\n[t -> vectorize -> v]`;
	const registry = await registryOf();
	const state = await DocumentState.read('file:///test.machine', `${HEADER}\n[(document=doc) -> extract -> (text=t)]\n[t -> vectorize -> v]`, registry, null);
	const labels = async (needle: string, into: number) =>
		(await getCompletions(state, positionOf(text, needle, into), text, registry)).map(item => item.label);
	const sources = await labels('doc, ', 5);
	assert(sources.includes('document=') && sources.includes('max_pages='), `the step's args: ${sources}`);
	assert(sources.includes('doc'), 'and the nodes');
	const targets = await labels('(text=t', 1);
	assert(targets.includes('text='), `the step's outputs: ${targets}`);
	assert(!targets.includes('document='), 'not its args');
	const steps = await labels('-> vectorize', 3);
	assert(steps.includes('extract') && steps.includes('vectorize'), `header and fabric aliases: ${steps}`);
	assertEqual(contextAt('[(a, b) -> f -> (x, ', { line: 0, character: 20 }).type, 'targets', 'after the second arrow');
	assertEqual(contextAt('(a, b', { line: 0, character: 5 }).type, 'sources', 'in a source group');
}

// TEST12844: hovering a step shows its cap's args and outputs by name;
// hovering a named member shows that arg.
async function test12844_hoversNameWhatTheyAreOver() {
	const text = `${HEADER}\n[(document=doc, max_pages=20) -> extract -> text]`;
	const registry = await registryOf();
	const state = await DocumentState.read('file:///test.machine', text, registry, null);
	const hover = async (needle: string, into = 0) => (await getHoverInfo(state, positionOf(text, needle, into), registry)).value;
	const step = await hover('-> extract', 4);
	assert(step.includes('| `document` |') && step.includes('| `max_pages` |') && step.includes('| `text` |'), step);
	const arg = await hover('max_pages', 1);
	assert(arg.includes('**max_pages**') && arg.includes('At most this many pages'), arg);
	const constant = await hover('20');
	assert(constant.includes('Given the constant `20`'), constant);
}

// TEST12845: a document that names another machine reads it from the file
// its header names, relative to the document's own file, and resolves with
// its steps written in — their caps fetched too.
async function test12845_machinesInStepPositionAreReadFromFiles() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-lsp-'));
	try {
		fs.writeFileSync(path.join(dir, 'embed.machine'), `[t -> vectorize -> v]`, 'utf-8');
		const file = path.join(dir, 'top.machine');
		const text = `${HEADER}[embedding machine "embed.machine"][doc -> extract -> text][(t=text) -> embedding -> (v=vec)]`;
		fs.writeFileSync(file, text, 'utf-8');
		const state = await read(text, undefined, file);
		assertEqual(state.problems, [], 'it resolves');
		assertEqual(state.machine.strands()[0].edges().length, 2, "the included machine's step is written in");
		// Without a file, there is nothing to read the reference against.
		const untitled = await read(text);
		assertEqual(untitled.problems[0].code, 'MachineReferenceWithoutSource', 'an untitled document');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

async function main() {
	console.log('Machine notation language server tests\n');
	await runTest('TEST12840: a_document_is_read_against_the_registry', test12840_aDocumentIsReadAgainstTheRegistry);
	await runTest('TEST12841: problems_are_placed_where_they_are', test12841_problemsArePlacedWhereTheyAre);
	await runTest('TEST12842: the_token_under_the_cursor', test12842_theTokenUnderTheCursor);
	await runTest('TEST12843: completions_offer_names_of_the_step', test12843_completionsOfferNamesOfTheStep);
	await runTest('TEST12844: hovers_name_what_they_are_over', test12844_hoversNameWhatTheyAreOver);
	await runTest('TEST12845: machines_in_step_position_are_read_from_files', test12845_machinesInStepPositionAreReadFromFiles);
	console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
