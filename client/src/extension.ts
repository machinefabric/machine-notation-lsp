import * as path from 'path';
import {
	workspace as Workspace,
	window as Window,
	ExtensionContext,
	TextDocument,
	OutputChannel,
	WorkspaceFolder,
	Uri,
	commands,
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	TransportKind,
} from 'vscode-languageclient/node';

import { GraphViewProvider } from './graphViewProvider';

let defaultClient: LanguageClient;
const clients = new Map<string, LanguageClient>();

// Buffer the latest graph data so it's available when the panel opens
let latestGraphData: { uri: string; mermaid: string | null; error?: string } | null = null;

let _sortedWorkspaceFolders: string[] | undefined;
function sortedWorkspaceFolders(): string[] {
	if (_sortedWorkspaceFolders === void 0) {
		_sortedWorkspaceFolders = Workspace.workspaceFolders
			? Workspace.workspaceFolders
					.map((folder) => {
						let result = folder.uri.toString();
						if (result.charAt(result.length - 1) !== '/') {
							result = result + '/';
						}
						return result;
					})
					.sort((a, b) => a.length - b.length)
			: [];
	}
	return _sortedWorkspaceFolders;
}
Workspace.onDidChangeWorkspaceFolders(() => (_sortedWorkspaceFolders = undefined));

function getOuterMostWorkspaceFolder(folder: WorkspaceFolder): WorkspaceFolder {
	const sorted = sortedWorkspaceFolders();
	for (const element of sorted) {
		let uri = folder.uri.toString();
		if (uri.charAt(uri.length - 1) !== '/') {
			uri = uri + '/';
		}
		if (uri.startsWith(element)) {
			return Workspace.getWorkspaceFolder(Uri.parse(element))!;
		}
	}
	return folder;
}

function createClientOptions(
	outputChannel: OutputChannel,
	folder?: WorkspaceFolder
): LanguageClientOptions {
	const config = Workspace.getConfiguration('machine');
	return {
		documentSelector: folder
			? [{ scheme: 'file', language: 'machine', pattern: `${folder.uri.fsPath}/**/*.machine` }]
			: [
					{ scheme: 'untitled', language: 'machine' },
					{ scheme: 'untitled', language: 'machine', pattern: '**/*.machine' },
			  ],
		diagnosticCollectionName: 'machine-notation-lsp',
		workspaceFolder: folder,
		outputChannel: outputChannel,
		initializationOptions: {
			registryUrl: config.get('registryUrl', 'https://capdag.com'),
			registryCacheTtl: config.get('registryCacheTtl', 300),
		},
	};
}

function handleGraphData(params: { uri: string; mermaid: string | null; error?: string }) {
	latestGraphData = params;
	if (GraphViewProvider.currentPanel) {
		if (params.mermaid) {
			GraphViewProvider.currentPanel.updateGraph(params.mermaid);
		} else if (params.error) {
			GraphViewProvider.currentPanel.showError(params.error);
		}
	}
}

async function startClient(
	serverModule: string,
	outputChannel: OutputChannel,
	folder?: WorkspaceFolder
): Promise<LanguageClient> {
	const serverOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc },
	};
	const client = new LanguageClient(
		'machine-notation-lsp',
		'Machine Notation Language Server',
		serverOptions,
		createClientOptions(outputChannel, folder)
	);

	// In v9, start() returns a Promise. We must await it before registering notification handlers.
	await client.start();

	client.onNotification('machine/graphData', handleGraphData);

	return client;
}

export function activate(context: ExtensionContext) {
	const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));
	const outputChannel: OutputChannel = Window.createOutputChannel('Machine Notation LSP');

	// Register the showGraph command — opens graph panel beside the editor
	context.subscriptions.push(
		commands.registerCommand('machine.showGraph', () => {
			GraphViewProvider.createOrShow(context.extensionUri);
			// If we already have graph data buffered, send it immediately
			if (latestGraphData) {
				if (GraphViewProvider.currentPanel) {
					if (latestGraphData.mermaid) {
						GraphViewProvider.currentPanel.updateGraph(latestGraphData.mermaid);
					} else if (latestGraphData.error) {
						GraphViewProvider.currentPanel.showError(latestGraphData.error);
					}
				}
			}
		})
	);

	function didOpenTextDocument(document: TextDocument): void {
		if (document.languageId !== 'machine' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
			return;
		}

		const uri = document.uri;

		// Untitled files go to a default client
		if (uri.scheme === 'untitled' && !defaultClient) {
			startClient(serverModule, outputChannel).then((client) => {
				defaultClient = client;
			});
			return;
		}

		let folder = Workspace.getWorkspaceFolder(uri);
		if (!folder) return;

		folder = getOuterMostWorkspaceFolder(folder);

		if (!clients.has(folder.uri.toString())) {
			const folderKey = folder.uri.toString();
			// Mark as in-progress to avoid double-starts
			clients.set(folderKey, null as unknown as LanguageClient);
			startClient(serverModule, outputChannel, folder).then((client) => {
				clients.set(folderKey, client);
			});
		}
	}

	Workspace.onDidOpenTextDocument(didOpenTextDocument);
	Workspace.textDocuments.forEach(didOpenTextDocument);
	Workspace.onDidChangeWorkspaceFolders((event) => {
		for (const folder of event.removed) {
			const client = clients.get(folder.uri.toString());
			if (client) {
				clients.delete(folder.uri.toString());
				client.stop();
			}
		}
	});
}

export function deactivate(): Thenable<void> {
	const promises: Thenable<void>[] = [];
	if (defaultClient) {
		promises.push(defaultClient.stop());
	}
	for (const client of clients.values()) {
		if (client) {
			promises.push(client.stop());
		}
	}
	return Promise.all(promises).then(() => undefined);
}
