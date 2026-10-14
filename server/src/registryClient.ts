// @ts-nocheck — capdag is a plain JS package without type declarations
import { FabricRegistryClient, CapUrn, isAliasToken, SYNTAX_CAP_HEADER, SYNTAX_WIRING } from 'capdag';

/** A definition a document needs that the registry did not give, and where the document needs it. */
export interface FetchFailure {
	message: string;
	code: string;
	location: any | null;
}

/**
 * The fabric registry, as the server reads it: one manifest of it, the one
 * the settings pin or, without a pin, the one the registry has promoted as
 * its latest.
 *
 * What it fetches it holds, so the client itself is the definitions every
 * document is parsed against, and the aliases a document's steps are
 * resolved by.
 */
export class RegistryClient {
	readonly client: any; // FabricRegistryClient
	private loadingAll: Promise<void> | null = null;

	private constructor(client: any) {
		this.client = client;
	}

	/**
	 * @param baseUrl - The registry's base URL
	 * @param manifestVersion - A manifest to pin, or null to follow the latest
	 * @param fetchImpl - How a URL is fetched (the runtime's fetch when not given)
	 */
	static async open(baseUrl: string, manifestVersion: number | null, fetchImpl?: (url: string) => Promise<any>): Promise<RegistryClient> {
		const options = fetchImpl ? { fetch: fetchImpl } : {};
		const client = manifestVersion === null
			? await FabricRegistryClient.latest(baseUrl, options)
			: new FabricRegistryClient(baseUrl, manifestVersion, options);
		return new RegistryClient(client);
	}

	/** The definitions a document is parsed against. */
	get definitions(): any {
		return this.client;
	}

	/**
	 * Fetch what the statements need to resolve: the cap of every cap header,
	 * and, for every step no header of the statements declares, the fabric
	 * alias of that name and the cap it names. A step name that is no alias
	 * is left for the parser to call undefined. Every other failure is
	 * returned, at the statement that needs the definition.
	 */
	async definitionsFor(statements: any[]): Promise<FetchFailure[]> {
		const failures: FetchFailure[] = [];
		const declared = new Set(statements.filter(s => s.kind !== SYNTAX_WIRING).map(s => s.alias));
		const fetched = new Set<string>();
		const fetchCap = async (urn: string, location: any) => {
			let key: string;
			try {
				key = CapUrn.fromString(urn).toString();
			} catch (_) {
				// A header whose URN does not parse is the parser's to report.
				return;
			}
			if (fetched.has(key)) return;
			fetched.add(key);
			try {
				await this.client.getCap(key);
			} catch (error: any) {
				failures.push({ message: error.message, code: error.code || 'Registry', location });
			}
		};
		for (const statement of statements) {
			if (statement.kind === SYNTAX_CAP_HEADER) {
				await fetchCap(statement.capUrn, statement.capUrnLocation);
			}
		}
		const steps = new Set<string>();
		for (const statement of statements) {
			if (statement.kind !== SYNTAX_WIRING) continue;
			const step = statement.wiring.step;
			if (declared.has(step) || steps.has(step) || !isAliasToken(step)) continue;
			steps.add(step);
			const manifest = await this.client.manifest();
			if (manifest.aliases[step.toLowerCase()] === undefined) continue;
			try {
				const alias = await this.client.getAlias(step);
				if (alias.target.startsWith('cap:')) await fetchCap(alias.target, statement.wiring.stepLocation);
			} catch (error: any) {
				failures.push({ message: error.message, code: error.code || 'Registry', location: statement.wiring.stepLocation });
			}
		}
		return failures;
	}

	/**
	 * Every cap and alias of the manifest, each cap with its media: what
	 * completions offer. Loaded once; a failure is thrown to every caller.
	 */
	async allCaps(): Promise<any[]> {
		if (this.loadingAll === null) {
			this.loadingAll = this.client.loadAll().catch((error: any) => {
				this.loadingAll = null;
				throw error;
			});
		}
		await this.loadingAll;
		return this.client.cachedCaps();
	}

	/** The media definition a URN names, fetched when not held. */
	async mediaDef(urn: string): Promise<any> {
		return this.client.getMediaDef(urn);
	}

	/** The cap a URN names, fetched when not held. */
	async cap(urn: string): Promise<any> {
		return this.client.getCap(urn);
	}
}
