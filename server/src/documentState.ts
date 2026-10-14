// @ts-nocheck — capdag is a plain JS package without type declarations
import {
	parseSyntax,
	parseMachineWithAST,
	MachineSyntaxError,
	MachineAbstractionError,
	FileMachineSource,
	NoMachineSource,
	fileMachineId,
	CapUrn,
	SYNTAX_CAP_HEADER,
	SYNTAX_MACHINE_HEADER,
	SYNTAX_WIRING,
} from 'capdag';
import * as path from 'path';
import { RegistryClient } from './registryClient';

/**
 * Location from the notation parser: { start: {offset, line, column}, end: {offset, line, column} }.
 * Lines and columns are 1-based.
 */
export interface PeggyLocation {
	start: { offset: number; line: number; column: number };
	end: { offset: number; line: number; column: number };
}

/** What is wrong with a document, and where; null when the whole document is meant. */
export interface DocumentProblem {
	message: string;
	code: string;
	location: PeggyLocation | null;
}

export type TokenType =
	| 'alias'            // a header's alias, or a step
	| 'capUrn'           // a cap header's URN
	| 'machineReference' // a machine header's reference
	| 'node'             // a node, as a member or a target
	| 'argName'          // the arg a member names
	| 'outputName'       // the output a target names
	| 'constant'         // a constant a member gives its arg
	| 'policy';          // a step's policy

export interface TokenInfo {
	type: TokenType;
	value: string;
	statement: any;
	location: PeggyLocation;
	/** For an argName, an outputName, a constant: the step of its wiring. */
	step?: string;
}

/**
 * Every statement a document's machine headers lead to, read from the files
 * they name: what the definitions of a document are fetched for. A file that
 * does not read or does not parse is left for the parser to report.
 */
function includedStatements(statements: any[], source: any, id: string | null, seen: Set<string>): any[] {
	const found: any[] = [];
	for (const statement of statements) {
		if (statement.kind !== SYNTAX_MACHINE_HEADER) continue;
		let loaded;
		try {
			loaded = source.load(statement.reference, id);
		} catch (_) {
			continue;
		}
		if (seen.has(loaded.id)) continue;
		seen.add(loaded.id);
		let inner;
		try {
			inner = parseSyntax(loaded.notation);
		} catch (_) {
			continue;
		}
		found.push(...inner, ...includedStatements(inner, source, loaded.id, seen));
	}
	return found;
}

/** The wirings of the statements whose step stands for the cap URN `capUrn`. */
function wiringsOfCap(statements: any[], aliasMap: Map<string, any>, capUrn: string): any[] {
	let wanted;
	try {
		wanted = CapUrn.fromString(capUrn);
	} catch (_) {
		return [];
	}
	return statements.filter(s => {
		if (s.kind !== SYNTAX_WIRING) return false;
		const entry = aliasMap.get(s.wiring.step);
		return entry !== undefined && entry.capUrn.isEquivalent(wanted);
	}).map(s => s.wiring);
}

/**
 * Where in the document a refusal is about. A syntax error says where it
 * stands; a resolution error says what it is about — a statement, a cap and
 * the name of one of its args or outputs, a node — and is placed where the
 * text writes that.
 */
export function locate(error: any, statements: any[] | null, aliasMap: Map<string, any> | null): PeggyLocation | null {
	if (error.location) return error.location;
	if (!statements) return null;
	if (Number.isInteger(error.position) && statements[error.position]) {
		return statements[error.position].location;
	}
	const members = (wiring: any) => [...wiring.sources, ...wiring.targets];
	if (typeof error.node === 'string') {
		for (const s of statements) {
			if (s.kind !== SYNTAX_WIRING) continue;
			const found = members(s.wiring).find(m => m.node === error.node);
			if (found) return found.valueLocation;
		}
	}
	if (typeof error.alias === 'string') {
		const header = statements.find(s => s.kind !== SYNTAX_WIRING && s.alias === error.alias);
		if (header) return header.aliasLocation;
	}
	if (typeof error.capUrn === 'string' && aliasMap) {
		const wirings = wiringsOfCap(statements, aliasMap, error.capUrn);
		for (const wiring of wirings) {
			if (typeof error.argName === 'string') {
				const member = wiring.sources.find(m => m.name === error.argName);
				if (member) return error.code === 'ConstantFailsValidation' ? member.valueLocation : member.location;
			}
			if (typeof error.outputName === 'string' || typeof error.output === 'string') {
				const target = wiring.targets.find(t => t.name === (error.outputName || error.output));
				if (target) return target.location;
			}
			if (Array.isArray(error.members) && error.members.length > 0 && typeof error.members[0].node === 'string') {
				const member = wiring.sources.find(m => m.node === error.members[0].node);
				if (member) return member.location;
			}
		}
		if (wirings.length > 0) {
			const wiring = wirings[0];
			if (error.code === 'MainInputUnbound' || error.code === 'UnmatchedSourceInCapArgs') return wiring.sourcesLocation;
			if (error.code === 'NoMainOutput' || error.code === 'OutputTakenTwice') return wiring.targetsLocation;
			return wiring.stepLocation;
		}
		const header = statements.find(s => {
			if (s.kind !== SYNTAX_CAP_HEADER) return false;
			try {
				return CapUrn.fromString(s.capUrn).isEquivalent(CapUrn.fromString(error.capUrn));
			} catch (_) {
				return false;
			}
		});
		if (header) return header.capUrnLocation;
	}
	return null;
}

/**
 * What the server knows of one .machine document: its statements, and —
 * when it resolves — its machine, its aliases and the media each node
 * holds; otherwise what is wrong with it, each problem where it stands.
 */
export class DocumentState {
	readonly uri: string;
	readonly text: string;
	readonly statements: any[] | null;
	readonly machine: any | null;
	readonly aliasMap: Map<string, any> | null;
	readonly nodeMedia: Map<string, any> | null;
	readonly problems: DocumentProblem[];

	private constructor(uri: string, text: string, fields: {
		statements: any[] | null;
		machine: any | null;
		aliasMap: Map<string, any> | null;
		nodeMedia: Map<string, any> | null;
		problems: DocumentProblem[];
	}) {
		this.uri = uri;
		this.text = text;
		this.statements = fields.statements;
		this.machine = fields.machine;
		this.aliasMap = fields.aliasMap;
		this.nodeMedia = fields.nodeMedia;
		this.problems = fields.problems;
	}

	/**
	 * Read a document: its statements, then the definitions they need from the
	 * registry, then the machine they make. `filePath` is the document's file,
	 * when it has one: the machines its headers name are read relative to it.
	 */
	static async read(uri: string, text: string, registry: RegistryClient, filePath: string | null): Promise<DocumentState> {
		const empty = { statements: null, machine: null, aliasMap: null, nodeMedia: null };
		let statements;
		try {
			statements = text.trim().length === 0 ? [] : parseSyntax(text);
		} catch (error: any) {
			return new DocumentState(uri, text, { ...empty, problems: [problemOf(error, null, null)] });
		}

		const source = filePath === null ? new NoMachineSource() : new FileMachineSource(path.dirname(filePath));
		let id = null;
		if (filePath !== null) {
			try {
				id = fileMachineId(filePath);
			} catch (_) {
				// A document not yet saved has no file to be known by.
				id = null;
			}
		}
		const everyStatement = [...statements, ...includedStatements(statements, source, id, new Set(id === null ? [] : [id]))];
		const failures = await registry.definitionsFor(everyStatement);
		if (failures.length > 0) {
			// The parser would say only that a cap is unknown: what the registry
			// said is the reason, at the statement that needs it.
			const own = failures.filter(f => statements.some(s => s.location && f.location && within(f.location, s.location)));
			const problems = own.length > 0 ? own : failures.map(f => ({ ...f, location: null }));
			return new DocumentState(uri, text, { ...empty, statements, problems });
		}

		try {
			const result = parseMachineWithAST(text, registry.definitions, id === null ? { source } : { source, id });
			return new DocumentState(uri, text, {
				statements: result.statements,
				machine: result.machine,
				aliasMap: result.aliasMap,
				nodeMedia: result.nodeMedia,
				problems: [],
			});
		} catch (error: any) {
			if (!(error instanceof MachineSyntaxError) && !(error instanceof MachineAbstractionError)) throw error;
			return new DocumentState(uri, text, {
				...empty,
				statements,
				problems: [problemOf(error, statements, stepCaps(statements, registry.definitions))],
			});
		}
	}

	/** The first problem, or null when there is none. */
	get error(): DocumentProblem | null {
		return this.problems.length > 0 ? this.problems[0] : null;
	}

	/**
	 * The statement whose location contains a position (LSP convention:
	 * 0-based line and character).
	 */
	getStatementAt(line: number, character: number): any | null {
		if (!this.statements) return null;
		for (const statement of this.statements) {
			if (statement.location && inRange(line + 1, character + 1, statement.location)) return statement;
		}
		return null;
	}

	/** The token at a position (LSP convention: 0-based line and character). */
	getTokenAt(line: number, character: number): TokenInfo | null {
		const statement = this.getStatementAt(line, character);
		if (!statement) return null;
		const l = line + 1;
		const c = character + 1;
		const at = (loc: PeggyLocation | null) => loc !== null && loc !== undefined && inRange(l, c, loc);

		if (statement.kind === SYNTAX_CAP_HEADER) {
			if (at(statement.aliasLocation)) return { type: 'alias', value: statement.alias, statement, location: statement.aliasLocation };
			if (at(statement.capUrnLocation)) return { type: 'capUrn', value: statement.capUrn, statement, location: statement.capUrnLocation };
			return null;
		}
		if (statement.kind === SYNTAX_MACHINE_HEADER) {
			if (at(statement.aliasLocation)) return { type: 'alias', value: statement.alias, statement, location: statement.aliasLocation };
			if (at(statement.referenceLocation)) {
				return { type: 'machineReference', value: statement.reference, statement, location: statement.referenceLocation };
			}
			return null;
		}
		const wiring = statement.wiring;
		const step = wiring.step;
		for (const member of wiring.sources) {
			if (member.name !== null && at(member.nameLocation)) {
				return { type: 'argName', value: member.name, statement, location: member.nameLocation, step };
			}
			if (at(member.valueLocation)) {
				return member.isConstant
					? { type: 'constant', value: this.text.slice(member.valueLocation.start.offset, member.valueLocation.end.offset), statement, location: member.valueLocation, step }
					: { type: 'node', value: member.node, statement, location: member.valueLocation };
			}
		}
		if (at(wiring.stepLocation)) return { type: 'alias', value: step, statement, location: wiring.stepLocation };
		if (at(wiring.policyLocation)) {
			return { type: 'policy', value: wiring.policy.toNotation(), statement, location: wiring.policyLocation, step };
		}
		for (const target of wiring.targets) {
			if (target.name !== null && at(target.nameLocation)) {
				return { type: 'outputName', value: target.name, statement, location: target.nameLocation, step };
			}
			if (at(target.valueLocation)) return { type: 'node', value: target.node, statement, location: target.valueLocation };
		}
		return null;
	}
}

/**
 * The cap each step of the statements stands for, by the step's name: a
 * header's, or the fabric alias's the definitions hold. What a refusal that
 * names a cap is placed by when the machine did not resolve.
 */
function stepCaps(statements: any[], definitions: any): Map<string, any> {
	const caps = new Map<string, any>();
	for (const s of statements) {
		if (s.kind !== SYNTAX_CAP_HEADER || caps.has(s.alias)) continue;
		try {
			caps.set(s.alias, { capUrn: CapUrn.fromString(s.capUrn) });
		} catch (_) {
			// A header whose URN does not parse stands for no cap.
		}
	}
	for (const s of statements) {
		if (s.kind !== SYNTAX_WIRING || caps.has(s.wiring.step)) continue;
		const target = definitions.aliasTarget(s.wiring.step);
		if (target !== null && target.startsWith('cap:')) caps.set(s.wiring.step, { capUrn: CapUrn.fromString(target) });
	}
	return caps;
}

function problemOf(error: any, statements: any[] | null, aliasMap: Map<string, any> | null): DocumentProblem {
	return { message: error.message, code: error.code || 'Error', location: locate(error, statements, aliasMap) };
}

function within(inner: PeggyLocation, outer: PeggyLocation): boolean {
	return inner.start.offset >= outer.start.offset && inner.end.offset <= outer.end.offset;
}

function inRange(line: number, col: number, loc: PeggyLocation): boolean {
	const { start, end } = loc;
	if (line < start.line || line > end.line) return false;
	if (line === start.line && col < start.column) return false;
	if (line === end.line && col > end.column) return false;
	return true;
}
