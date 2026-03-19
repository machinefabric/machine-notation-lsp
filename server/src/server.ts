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

import { DocumentState } from './documentState';
import { getDiagnostics } from './diagnosticsProvider';
import { getHoverInfo } from './hoverProvider';
import { getCompletions } from './completionProvider';
import { RegistryClient } from './registryClient';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const documentStates = new Map<string, DocumentState>();
const lastGoodStates = new Map<string, DocumentState>();

let registryClient: RegistryClient;

connection.onInitialize((params: InitializeParams) => {
	const config = params.initializationOptions || {};
	registryClient = new RegistryClient(
		config.registryUrl || 'https://capdag.com',
		config.registryCacheTtl || 300
	);

	// Warm registry cache eagerly so first completion is fast
	registryClient.fetchCapabilities().catch(() => {});

	return {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Incremental,
			},
			hoverProvider: true,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['[', ':', '=', ';', ' ', '-'],
			},
		},
	};
});

function handleDocumentChange(document: TextDocument): void {
	const state = new DocumentState(document.uri, document.getText());
	documentStates.set(document.uri, state);

	// Preserve last successful parse for completions during error states
	if (state.machine) {
		lastGoodStates.set(document.uri, state);
	}

	const diagnostics: Diagnostic[] = getDiagnostics(state);
	connection.sendDiagnostics({ uri: document.uri, diagnostics });

	// Send graph data to client for Mermaid rendering
	// Use last good state when current parse fails so the graph stays visible
	const graphState = state.machine ? state : lastGoodStates.get(document.uri);
	if (graphState?.machine) {
		connection.sendNotification('machine/graphData', {
			uri: document.uri,
			mermaid: graphState.machine.toMermaid(),
		});
	} else {
		connection.sendNotification('machine/graphData', {
			uri: document.uri,
			mermaid: null,
			error: state.error ? state.error.message : 'Parse failed',
		});
	}
}

connection.onHover(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const state = documentStates.get(document.uri);
	if (!state) return null;

	const hover = await getHoverInfo(state, params.position, registryClient);
	if (!hover) return null;

	return {
		contents: {
			kind: MarkupKind.Markdown,
			value: hover.value,
		},
		range: hover.range,
	};
});

connection.onCompletion(async (params): Promise<CompletionItem[]> => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];

	const state = documentStates.get(document.uri);
	if (!state) return [];

	// Use last good state for alias/node data when current parse failed
	const stateForCompletions = state.machine ? state : (lastGoodStates.get(document.uri) || state);

	return getCompletions(stateForCompletions, params.position, document.getText(), registryClient);
});

documents.onDidOpen((event) => {
	handleDocumentChange(event.document);
});

documents.onDidChangeContent((event) => {
	handleDocumentChange(event.document);
});

documents.onDidClose((event) => {
	documentStates.delete(event.document.uri);
	lastGoodStates.delete(event.document.uri);
});

documents.listen(connection);
connection.listen();
