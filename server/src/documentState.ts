// @ts-nocheck — capdag is a plain JS package without type declarations
const capdag = require('capdag');
const { parseMachineWithAST, MachineSyntaxError } = capdag;

/**
 * Location from Peggy parser: { start: {offset, line, column}, end: {offset, line, column} }
 * Peggy lines are 1-based, columns are 1-based.
 */
interface PeggyLocation {
	start: { offset: number; line: number; column: number };
	end: { offset: number; line: number; column: number };
}

interface HeaderStatement {
	type: 'header';
	alias: string;
	capUrn: string;
	location: PeggyLocation;
	aliasLocation: PeggyLocation;
	capUrnLocation: PeggyLocation;
}

interface WiringStatement {
	type: 'wiring';
	sources: string[];
	capAlias: string;
	target: string;
	location: PeggyLocation;
	sourceLocations: PeggyLocation[];
	capAliasLocation: PeggyLocation;
	targetLocation: PeggyLocation;
}

type ParsedStatement = HeaderStatement | WiringStatement;

export interface TokenInfo {
	type: 'alias' | 'capUrn' | 'node' | 'arrow' | 'bracket';
	value: string;
	statement: ParsedStatement;
	location: PeggyLocation;
}

/**
 * Parsed state for a single .machine document.
 *
 * On construction, parses the document text using capdag's parseMachineWithAST().
 * On success: machine + statements + aliasMap + nodeMedia populated, error = null.
 * On failure: error populated, machine = null.
 */
export class DocumentState {
	readonly uri: string;
	readonly text: string;
	readonly machine: any | null; // Machine from capdag
	readonly statements: ParsedStatement[] | null;
	readonly aliasMap: Map<string, any> | null; // alias → { capUrn, position, location, aliasLocation, capUrnLocation }
	readonly nodeMedia: Map<string, any> | null; // node_name → MediaUrn
	readonly error: any | null; // MachineSyntaxError

	constructor(uri: string, text: string) {
		this.uri = uri;
		this.text = text;

		try {
			const result = parseMachineWithAST(text);
			this.machine = result.machine;
			this.statements = result.statements;
			this.aliasMap = result.aliasMap;
			this.nodeMedia = result.nodeMedia;
			this.error = null;
		} catch (e: any) {
			this.machine = null;
			this.statements = null;
			this.aliasMap = null;
			this.nodeMedia = null;
			this.error = e;
		}
	}

	/**
	 * Find the statement whose location range contains the given position.
	 * Position uses LSP convention: 0-based line, 0-based character.
	 */
	getStatementAt(line: number, character: number): ParsedStatement | null {
		if (!this.statements) return null;

		// Convert LSP position (0-based) to Peggy position (1-based)
		const peggyLine = line + 1;
		const peggyCol = character + 1;

		for (const stmt of this.statements) {
			if (!stmt.location) continue;
			const loc = stmt.location;
			if (this._positionInRange(peggyLine, peggyCol, loc)) {
				return stmt;
			}
		}
		return null;
	}

	/**
	 * Find the specific token at the given position within a statement.
	 * Position uses LSP convention: 0-based line, 0-based character.
	 */
	getTokenAt(line: number, character: number): TokenInfo | null {
		const stmt = this.getStatementAt(line, character);
		if (!stmt) return null;

		const peggyLine = line + 1;
		const peggyCol = character + 1;

		if (stmt.type === 'header') {
			if (stmt.aliasLocation && this._positionInRange(peggyLine, peggyCol, stmt.aliasLocation)) {
				return { type: 'alias', value: stmt.alias, statement: stmt, location: stmt.aliasLocation };
			}
			if (stmt.capUrnLocation && this._positionInRange(peggyLine, peggyCol, stmt.capUrnLocation)) {
				return { type: 'capUrn', value: stmt.capUrn, statement: stmt, location: stmt.capUrnLocation };
			}
		} else if (stmt.type === 'wiring') {
			// Check source locations
			if (stmt.sourceLocations) {
				for (let i = 0; i < stmt.sourceLocations.length; i++) {
					const srcLoc = stmt.sourceLocations[i];
					if (srcLoc && this._positionInRange(peggyLine, peggyCol, srcLoc)) {
						return { type: 'node', value: stmt.sources[i], statement: stmt, location: srcLoc };
					}
				}
			}

			// Check cap alias location
			if (stmt.capAliasLocation && this._positionInRange(peggyLine, peggyCol, stmt.capAliasLocation)) {
				return { type: 'alias', value: stmt.capAlias, statement: stmt, location: stmt.capAliasLocation };
			}

			// Check target location
			if (stmt.targetLocation && this._positionInRange(peggyLine, peggyCol, stmt.targetLocation)) {
				return { type: 'node', value: stmt.target, statement: stmt, location: stmt.targetLocation };
			}
		}

		return null;
	}

	private _positionInRange(line: number, col: number, loc: PeggyLocation): boolean {
		const { start, end } = loc;
		if (line < start.line || line > end.line) return false;
		if (line === start.line && col < start.column) return false;
		if (line === end.line && col > end.column) return false;
		return true;
	}
}
