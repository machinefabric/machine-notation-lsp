import {
	Diagnostic,
	DiagnosticSeverity,
	Range,
	Position,
} from 'vscode-languageserver/node';

import { DocumentState } from './documentState';

/**
 * Convert a MachineSyntaxError into LSP Diagnostic[].
 *
 * Uses the error's location property (from Peggy parser) for precise positioning.
 * Falls back to first line if no location is available.
 */
export function getDiagnostics(state: DocumentState): Diagnostic[] {
	if (!state.error) {
		return [];
	}

	const error = state.error;
	let range: Range;

	if (error.location) {
		// Peggy locations are 1-based; LSP positions are 0-based
		const loc = error.location;
		range = Range.create(
			Position.create(loc.start.line - 1, loc.start.column - 1),
			Position.create(loc.end.line - 1, loc.end.column - 1)
		);
	} else {
		// No location — highlight the first line
		range = Range.create(
			Position.create(0, 0),
			Position.create(0, state.text.length > 0 ? Math.min(state.text.indexOf('\n'), state.text.length) : 0)
		);
		// Fix: if indexOf returns -1, use full first line
		if (range.end.character <= 0) {
			const firstLineEnd = state.text.indexOf('\n');
			range = Range.create(
				Position.create(0, 0),
				Position.create(0, firstLineEnd >= 0 ? firstLineEnd : state.text.length)
			);
		}
	}

	return [{
		severity: DiagnosticSeverity.Error,
		range,
		message: error.message,
		source: 'machine',
		code: error.code,
	}];
}
