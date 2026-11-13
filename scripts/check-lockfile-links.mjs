// A COMMITTED LOCKFILE RESOLVES ITS PACKAGES FROM THE REGISTRY OR FROM INSIDE
// ITS OWN REPOSITORY.
//
// A package-lock.json written while a dependency was installed from a working
// copy beside this one (`"link": true`, `"resolved": "../tagged-urn-js"`)
// names a folder a clean checkout elsewhere does not have, and `npm ci` there
// fails. This refuses every entry of a lockfile git holds for this repository
// that is located, linked or resolved outside it, naming the file and the
// package; registry and git URLs, and links between workspaces inside the
// repository, are what a clean checkout can install and pass.
//
// The one exception is a file: dependency the repository declares itself: a
// package its package.json names as `"<name>": "file:<folder>"`, beside the
// lockfile. Its link passes when it is that package, linked to that folder,
// and so do the folder's own entry and what is installed under it. In a
// package.json.wstemplate, a value that is `file:{{ … }}` outright declares
// the package the same way, and the folder is the one its render, the
// package.json, names. A value a local render chooses
// (`{% if … %}"file:{{ … }}"{% else %}…{% endif %}`) is not a declaration: as
// committed the package comes from the registry. Anything else linked or
// resolved outside the repository is refused.
//
// It reads each lockfile as git's index holds it, which is what a commit
// records and, in a clean clone, what was committed. The file on disk is
// not read: while dependencies are installed from local working copies it is
// rewritten with links on purpose, and that is not a lockfile anyone commits
// unless it is staged, which this then refuses. The package.json and
// package.json.wstemplate it reads declarations from are read the same way.
//
//   node scripts/check-lockfile-links.mjs
//
// Exits 0 when every lockfile is clean, 1 with one line per offending entry,
// and 2 when it cannot read a lockfile at all.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCKFILE_NAMES = ["package-lock.json", "npm-shrinkwrap.json"];
const READ_VERSIONS = new Set([2, 3]);
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const FILE_SPEC = "file:";
// `"<name>": "file:{{ … }}"` in a template: the whole value is a file: path
// the render fills in. A value wrapped in `{% … %}` does not match.
const TEMPLATE_FILE_DEPENDENCY = /"([^"\\]+)"\s*:\s*"file:\{\{[^"{}]*\}\}"/g;
// A URL scheme is two characters or more, so a Windows drive (C:\…) is a path.
const URL_SCHEME = /^([a-z][a-z0-9+.-]+):/i;

/** The name of the package an entry of `packages` installs, from its key. */
function packageName(key, entry) {
  const at = key.lastIndexOf("node_modules/");
  if (at >= 0) return key.slice(at + "node_modules/".length);
  // A package located outside node_modules (a workspace, or the folder a link
  // points at) is named by its own package.json, which npm copies only when
  // it differs from the folder's name.
  return typeof entry.name === "string" ? entry.name : path.posix.basename(key);
}

/** The filesystem path a `resolved` value names, or null when it is a URL. */
function resolvedPath(resolved) {
  const scheme = URL_SCHEME.exec(resolved);
  if (!scheme) return resolved;
  if (scheme[1].toLowerCase() === "file") return resolved.slice("file:".length);
  return null;
}

function outside(root, target) {
  const rel = path.relative(root, target);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/**
 * The file: dependencies a package.json and its .wstemplate declare, by
 * package name: the path the package.json gives after `file:`, or null when
 * only the template declares the package and its render names no folder.
 *
 * @param {{ manifest: string | null, manifestFile: string, template: string | null, templateFile: string }} sources
 *   each file's committed contents, null when the repository does not hold it
 * @returns {Map<string, { spec: string | null }>}
 */
export function manifestDeclarations({ manifest, manifestFile, template, templateFile }) {
  const declarations = new Map();
  if (manifest !== null) {
    let parsed;
    try {
      parsed = JSON.parse(manifest);
    } catch (error) {
      throw new Error(`${manifestFile}: is not JSON: ${error.message}`);
    }
    for (const section of DEPENDENCY_SECTIONS) {
      const dependencies = parsed[section];
      if (dependencies === undefined) continue;
      if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
        throw new Error(`${manifestFile}: "${section}" is not an object`);
      }
      for (const [name, spec] of Object.entries(dependencies)) {
        if (typeof spec === "string" && spec.startsWith(FILE_SPEC)) {
          declarations.set(name, { spec: spec.slice(FILE_SPEC.length) });
        }
      }
    }
  }
  if (template !== null) {
    for (const [, name] of template.matchAll(TEMPLATE_FILE_DEPENDENCY)) {
      if (!declarations.has(name)) declarations.set(name, { spec: null });
    }
  }
  return declarations;
}

/**
 * Null when the package's declaration allows it at this path outside the
 * repository; otherwise what the refusal adds: nothing for a package that is
 * not declared, or how its declaration differs.
 */
function undeclared(name, lockDir, target, declarations) {
  const declaration = declarations.get(name);
  if (declaration === undefined) return "";
  if (declaration.spec === null) {
    return "; package.json.wstemplate declares it as a file: dependency, but package.json, its render, names no folder for it";
  }
  if (path.resolve(lockDir, declaration.spec) === target) return null;
  return `; package.json declares it as ${FILE_SPEC}${declaration.spec}`;
}

/**
 * Every entry of one lockfile that leads outside the repository.
 *
 * @param {string} text the lockfile's contents
 * @param {string} file its path relative to the repository's root, as git lists it
 * @param {string} repoRoot the repository's root, absolute
 * @param {Map<string, { spec: string | null }>} declarations the file: dependencies the
 *   package.json beside it declares, from `manifestDeclarations`
 * @returns {string[]} one message per offending entry, naming the file and the package
 */
export function lockfileProblems(text, file, repoRoot, declarations = new Map()) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: is not JSON: ${error.message}`);
  }
  if (!READ_VERSIONS.has(lock.lockfileVersion)) {
    throw new Error(
      `${file}: lockfileVersion ${JSON.stringify(lock.lockfileVersion)} is not one this check reads (2 or 3); ` +
        "regenerate it with the npm the repository uses",
    );
  }
  if (lock.packages === null || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    throw new Error(`${file}: has no "packages" object`);
  }

  const lockDir = path.join(repoRoot, path.dirname(file));
  const declaredFolders = [...declarations.values()]
    .filter((declaration) => declaration.spec !== null)
    .map((declaration) => path.resolve(lockDir, declaration.spec));
  const problems = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key === "") continue;
    const name = packageName(key, entry);
    const location = path.resolve(lockDir, key);
    if (outside(repoRoot, location)) {
      if (!declaredFolders.some((folder) => !outside(folder, location))) {
        problems.push(`${file}: package "${name}" is located at ${key}, outside the repository`);
      }
      continue;
    }
    if (entry.link === true) {
      if (typeof entry.resolved !== "string") {
        problems.push(`${file}: package "${name}" (${key}) is a link with no "resolved" target`);
        continue;
      }
      const target = path.resolve(lockDir, entry.resolved);
      if (!outside(repoRoot, target)) continue;
      const reason = undeclared(name, lockDir, target, declarations);
      if (reason !== null) {
        problems.push(`${file}: package "${name}" (${key}) is linked to ${entry.resolved}, outside the repository${reason}`);
      }
      continue;
    }
    if (typeof entry.resolved === "string") {
      const local = resolvedPath(entry.resolved);
      if (local === null) continue;
      const target = path.resolve(lockDir, local);
      if (!outside(repoRoot, target)) continue;
      const reason = undeclared(name, lockDir, target, declarations);
      if (reason !== null) {
        problems.push(`${file}: package "${name}" (${key}) is resolved from ${entry.resolved}, outside the repository${reason}`);
      }
    }
  }
  return problems;
}

function git(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
}

/** The root of the git repository holding `dir`; an error when there is none. */
export function repositoryRoot(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(`${dir} is not inside a git checkout, so there are no committed lockfiles to read`);
  }
}

/** A file as git's index holds it, or null when the index does not hold it. */
function staged(repoRoot, file) {
  const listed = git(repoRoot, ["ls-files", "-z", "--cached", "--", `:(literal)${file}`]).split("\0").filter(Boolean);
  return listed.length === 0 ? null : git(repoRoot, ["show", `:${file}`]);
}

/** Every lockfile git's index holds for the repository, with what each leads outside it. */
export function repositoryProblems(repoRoot) {
  const files = git(repoRoot, ["ls-files", "-z", "--cached", "--", ...LOCKFILE_NAMES.map((n) => `:(glob)**/${n}`)])
    .split("\0")
    .filter(Boolean);
  const problems = [];
  for (const file of files) {
    const manifestFile = path.posix.join(path.posix.dirname(file), "package.json");
    const templateFile = `${manifestFile}.wstemplate`;
    const declarations = manifestDeclarations({
      manifest: staged(repoRoot, manifestFile),
      manifestFile,
      template: staged(repoRoot, templateFile),
      templateFile,
    });
    problems.push(...lockfileProblems(git(repoRoot, ["show", `:${file}`]), file, repoRoot, declarations));
  }
  return { files, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = repositoryProblems(repositoryRoot(path.dirname(fileURLToPath(import.meta.url))));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(problem);
    console.error(
      "A committed lockfile must resolve every package from the registry, or from the folder package.json " +
        "declares it at with file:: reinstall with the dependency declared as committed, not from a local working copy.",
    );
    process.exit(1);
  }
  console.log(`${result.files.length} lockfile(s), every package resolved from a URL, inside the repository, or from the folder package.json declares it at.`);
}
