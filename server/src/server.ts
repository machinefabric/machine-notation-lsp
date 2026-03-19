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

let registryClient: RegistryClient;

connection.onInitialize((params: InitializeParams) => {
	const config = params.initializationOptions || {};
	registryClient = new RegistryClient(
		config.registryUrl || 'https://capdag.com',
		config.registryCacheTtl || 300
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
				triggerCharacters: ['[', ':', '=', ';', ' ', '-'],
			},
		},
	};
});

function handleDocumentChange(document: TextDocument): void {
	const state = new DocumentState(document.uri, document.getText());
	documentStates.set(document.uri, state);

	const diagnostics: Diagnostic[] = getDiagnostics(state);
	connection.sendDiagnostics({ uri: document.uri, diagnostics });

	// Send graph data to client for Mermaid rendering
	if (state.machine) {
		const mermaidCode = state.machine.toMermaid();
		connection.sendNotification('machine/graphData', {
			uri: document.uri,
			mermaid: mermaidCode,
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

	return getCompletions(state, params.position, document.getText(), registryClient);
});

documents.onDidOpen((event) => {
	handleDocumentChange(event.document);
});

documents.onDidChangeContent((event) => {
	handleDocumentChange(event.document);
});

documents.onDidClose((event) => {
	documentStates.delete(event.document.uri);
});

documents.listen(connection);
connection.listen();
