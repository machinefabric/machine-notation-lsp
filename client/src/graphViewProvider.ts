import * as path from 'path';
import * as fs from 'fs';
import {
	Uri,
	WebviewPanel,
	ViewColumn,
	Webview,
	Disposable,
	window,
} from 'vscode';

export class GraphViewProvider {
	public static currentPanel: GraphViewProvider | undefined;
	private readonly _panel: WebviewPanel;
	private readonly _extensionUri: Uri;
	private _disposables: Disposable[] = [];

	private constructor(panel: WebviewPanel, extensionUri: Uri) {
		this._panel = panel;
		this._extensionUri = extensionUri;
		this._update();
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
	}

	public static createOrShow(extensionUri: Uri) {
		const column = window.activeTextEditor
			? window.activeTextEditor.viewColumn
			: undefined;

		if (GraphViewProvider.currentPanel) {
			GraphViewProvider.currentPanel._panel.reveal(column);
			return;
		}

		const panel = window.createWebviewPanel(
			'machineGraph',
			'Machine Graph',
			column || ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [Uri.joinPath(extensionUri, 'media')],
			}
		);

		GraphViewProvider.currentPanel = new GraphViewProvider(panel, extensionUri);
	}

	public updateGraph(mermaidCode: string) {
		this._panel.webview.postMessage({ type: 'graphData', mermaid: mermaidCode });
	}

	public showError(message: string) {
		this._panel.webview.postMessage({ type: 'error', message });
	}

	private _update() {
		this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
	}

	private _getHtmlForWebview(webview: Webview): string {
		const scriptPathOnDisk = Uri.joinPath(this._extensionUri, 'media', 'graph.js');
		const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

		const htmlPathOnDisk = Uri.joinPath(this._extensionUri, 'media', 'graph.html');
		let htmlContent = fs.readFileSync(htmlPathOnDisk.fsPath, 'utf8');

		htmlContent = htmlContent.replace('{{scriptUri}}', scriptUri.toString());

		return htmlContent;
	}

	private dispose() {
		GraphViewProvider.currentPanel = undefined;
		this._panel.dispose();

		while (this._disposables.length) {
			const disposable = this._disposables.pop();
			if (disposable) {
				disposable.dispose();
			}
		}
	}
}
