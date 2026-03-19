// @ts-nocheck — capdag is a plain JS package without type declarations
const capdag = require('capdag');
const { CapRegistryClient, CapRegistryEntry, MediaRegistryEntry } = capdag;

/**
 * Thin wrapper around capdag's CapRegistryClient for LSP-specific use.
 *
 * Delegates all actual work to capdag-js CapRegistryClient.
 * Handles async errors gracefully for non-critical operations (completions, hover enrichment)
 * but still exposes them — no silent swallowing.
 */
export class RegistryClient {
	private _client: InstanceType<typeof CapRegistryClient>;

	constructor(baseUrl: string, cacheTtlSeconds: number) {
		this._client = new CapRegistryClient(baseUrl, cacheTtlSeconds);
	}

	async fetchCapabilities(): Promise<any[]> {
		try {
			return await this._client.fetchCapabilities();
		} catch (e: any) {
			console.error(`[machine-lsp] Registry fetch failed: ${e.message}`);
			return [];
		}
	}

	async lookupCapByUrn(capUrnStr: string): Promise<any | null> {
		try {
			return await this._client.lookupCap(capUrnStr);
		} catch (e: any) {
			console.error(`[machine-lsp] Cap lookup failed for ${capUrnStr}: ${e.message}`);
			return null;
		}
	}

	async lookupMediaByUrn(mediaUrnStr: string): Promise<any | null> {
		try {
			return await this._client.lookupMedia(mediaUrnStr);
		} catch (e: any) {
			console.error(`[machine-lsp] Media lookup failed for ${mediaUrnStr}: ${e.message}`);
			return null;
		}
	}

	async getKnownMediaUrns(): Promise<string[]> {
		try {
			return await this._client.getKnownMediaUrns();
		} catch (e: any) {
			console.error(`[machine-lsp] getKnownMediaUrns failed: ${e.message}`);
			return [];
		}
	}

	async getKnownOps(): Promise<string[]> {
		try {
			return await this._client.getKnownOps();
		} catch (e: any) {
			console.error(`[machine-lsp] getKnownOps failed: ${e.message}`);
			return [];
		}
	}

	invalidate(): void {
		this._client.invalidate();
	}
}
