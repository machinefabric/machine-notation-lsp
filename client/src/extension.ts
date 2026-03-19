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

export function activate(context: ExtensionContext) {
	const module = context.asAbsolutePath(path.join('dist', 'server', 'server.js'));
	const outputChannel: OutputChannel = Window.createOutputChannel('Machine Notation LSP');

	// Register the showGraph command
	context.subscriptions.push(
		commands.registerCommand('machine.showGraph', () => {
			GraphViewProvider.createOrShow(context.extensionUri);
		})
	);

	function didOpenTextDocument(document: TextDocument): void {
		if (document.languageId !== 'machine' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
			return;
		}

		const uri = document.uri;

		// Untitled files go to a default client
		if (uri.scheme === 'untitled' && !defaultClient) {
			const serverOptions = {
				run: { module, transport: TransportKind.ipc },
				debug: { module, transport: TransportKind.ipc },
			};
			defaultClient = new LanguageClient(
				'machine-notation-lsp',
				'Machine Notation Language Server',
				serverOptions,
				createClientOptions(outputChannel)
			);
			defaultClient.start();
			setupClientHandlers(defaultClient, context);
			return;
		}

		let folder = Workspace.getWorkspaceFolder(uri);
		if (!folder) return;

		folder = getOuterMostWorkspaceFolder(folder);

		if (!clients.has(folder.uri.toString())) {
			const serverOptions = {
				run: { module, transport: TransportKind.ipc },
				debug: { module, transport: TransportKind.ipc },
			};
			const client = new LanguageClient(
				'machine-notation-lsp',
				'Machine Notation Language Server',
				serverOptions,
				createClientOptions(outputChannel, folder)
			);
			client.start();
			setupClientHandlers(client, context);
			clients.set(folder.uri.toString(), client);
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
		promises.push(client.stop());
	}
	return Promise.all(promises).then(() => undefined);
}

function setupClientHandlers(client: LanguageClient, _context: ExtensionContext) {
	client.onNotification(
		'machine/graphData',
		(params: { uri: string; mermaid: string | null; error?: string }) => {
			if (GraphViewProvider.currentPanel) {
				if (params.mermaid) {
					GraphViewProvider.currentPanel.updateGraph(params.mermaid);
				} else if (params.error) {
					GraphViewProvider.currentPanel.showError(params.error);
				}
			}
		}
	);
}
