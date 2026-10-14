import {
	Diagnostic,
	DiagnosticSeverity,
	Range,
	Position,
} from 'vscode-languageserver/node';

import { DocumentState, PeggyLocation } from './documentState';

/** A notation location (1-based lines and columns) as an LSP range (0-based). */
export function rangeOf(location: PeggyLocation): Range {
	return Range.create(
		Position.create(location.start.line - 1, location.start.column - 1),
		Position.create(location.end.line - 1, location.end.column - 1)
	);
}

/** The first line of a text: where a problem that is about the whole document is shown. */
function firstLine(text: string): Range {
	const end = text.indexOf('\n');
	return Range.create(Position.create(0, 0), Position.create(0, end >= 0 ? end : text.length));
}

/** Every problem of a document, each where it stands. */
export function getDiagnostics(state: DocumentState): Diagnostic[] {
	return state.problems.map(problem => ({
		severity: DiagnosticSeverity.Error,
		range: problem.location ? rangeOf(problem.location) : firstLine(state.text),
		message: problem.message,
		source: 'machine',
		code: problem.code,
	}));
}
