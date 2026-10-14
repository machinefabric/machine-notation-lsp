import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
	CompletionItem,
	InitializeParams,
	MarkupKind,
	Diagnostic,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { DocumentState } from './documentState';
import { getDiagnostics } from './diagnosticsProvider';
import { getHoverInfo } from './hoverProvider';
import { getCompletions } from './completionProvider';
import { RegistryClient } from './registryClient';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const documentStates = new Map<string, DocumentState>();
const lastGoodStates = new Map<string, DocumentState>();
// The newest read of each document: an older read that finishes after a
// newer one began is dropped, never shown over it.
const readCounters = new Map<string, number>();

/** The registry every document is read against: opened once, from the settings. */
let registryReady: Promise<RegistryClient>;

/** The fabric registry's public address, the same default every capdag library has. */
const DEFAULT_REGISTRY_URL = 'https://fabric.capdag.com';

connection.onInitialize((params: InitializeParams) => {
	const config = params.initializationOptions || {};
	const url: string = config.registryUrl || DEFAULT_REGISTRY_URL;
	const manifestVersion: number | null = Number.isInteger(config.manifestVersion) ? config.manifestVersion : null;
	registryReady = RegistryClient.open(url, manifestVersion);
	registryReady.then(
		registry => connection.console.info(`[machine-lsp] reading the fabric at ${url}, manifest v${registry.client.manifestVersion}`),
		error => connection.window.showErrorMessage(`Machine notation: the fabric registry at ${url} could not be opened: ${error.message}`)
	);
	return {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Incremental,
			},
			hoverProvider: true,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['[', ':', '=', ';', ' ', '-', '(', ','],
			},
		},
	};
});

/** The document's file, when it is one: what the machines it names are read relative to. */
function filePathOf(uri: string): string | null {
	const parsed = URI.parse(uri);
	return parsed.scheme === 'file' ? parsed.fsPath : null;
}

async function handleDocumentChange(document: TextDocument): Promise<void> {
	const count = (readCounters.get(document.uri) || 0) + 1;
	readCounters.set(document.uri, count);
	let state: DocumentState;
	try {
		const registry = await registryReady;
		state = await DocumentState.read(document.uri, document.getText(), registry, filePathOf(document.uri));
	} catch (error: any) {
		if (readCounters.get(document.uri) !== count) return;
		connection.sendDiagnostics({
			uri: document.uri,
			diagnostics: [{
				severity: 1,
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				message: `The document could not be read against the fabric registry: ${error.message}`,
				source: 'machine',
			}],
		});
		return;
	}
	if (readCounters.get(document.uri) !== count) return;
	documentStates.set(document.uri, state);
	if (state.machine) lastGoodStates.set(document.uri, state);

	const diagnostics: Diagnostic[] = getDiagnostics(state);
	connection.sendDiagnostics({ uri: document.uri, diagnostics });

	// The graph of the last machine that read, so it stays in view while the
	// text is being fixed.
	const graphState = state.machine ? state : lastGoodStates.get(document.uri);
	if (graphState?.machine) {
		connection.sendNotification('machine/graphData', { uri: document.uri, mermaid: graphState.machine.toMermaid() });
	} else {
		connection.sendNotification('machine/graphData', {
			uri: document.uri,
			mermaid: null,
			error: state.error ? state.error.message : 'The machine did not read',
		});
	}
}

connection.onHover(async (params) => {
	const state = documentStates.get(params.textDocument.uri);
	if (!state) return null;
	const hover = await getHoverInfo(state, params.position, await registryReady);
	if (!hover) return null;
	return {
		contents: { kind: MarkupKind.Markdown, value: hover.value },
		range: hover.range,
	};
});

connection.onCompletion(async (params): Promise<CompletionItem[]> => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];
	const state = documentStates.get(document.uri);
	if (!state) return [];
	// The last machine that read knows the nodes and steps while the text is
	// being written.
	const stateForCompletions = state.machine ? state : (lastGoodStates.get(document.uri) || state);
	return getCompletions(stateForCompletions, params.position, document.getText(), await registryReady);
});

documents.onDidOpen(event => {
	void handleDocumentChange(event.document);
});

documents.onDidChangeContent(event => {
	void handleDocumentChange(event.document);
});

documents.onDidClose(event => {
	documentStates.delete(event.document.uri);
	lastGoodStates.delete(event.document.uri);
	readCounters.delete(event.document.uri);
});

documents.listen(connection);
connection.listen();
