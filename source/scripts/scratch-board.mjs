#!/usr/bin/env node
// A throwaway repository and an unconfigured machine, with the client from this
// working tree running in it.
//
// For walking the setup and init flow, which is the one path that cannot be
// tried on a board that already exists. `seed-scratch.mjs` is its opposite: it
// drives setup to completion and hands back a project ready to use.
//
// Nothing here can reach a real board. The repository is a fresh temp
// directory, and EPIQ_GLOBAL_DIR points at another one, so `~/.epiq-global` is
// never read or written and every run starts from nothing.

import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wantsGui = process.argv.includes('gui');

const repo = mkdtempSync(join(tmpdir(), 'epiq-scratch-'));
const globalDir = mkdtempSync(join(tmpdir(), 'epiq-scratch-global-'));

const git = (...args) =>
	execFileSync('git', args, {cwd: repo, stdio: 'pipe'}).toString().trim();

git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Jonatan Lampa');
git('config', 'user.email', 'jola@example.com');
// A signing key would prompt, or fail, on a machine that has one configured.
git('config', 'commit.gpgsign', 'false');

/**
 * Three addresses, because the claiming step has nothing to say without them:
 * the one git is configured with, an old job's under a different name, and a
 * colleague's. The middle one is the case the feature exists for — it matches
 * nothing the user is called now.
 */
const commit = (subject, name, email) => {
	writeFileSync(join(repo, `${subject.replaceAll(' ', '-')}.txt`), subject);
	git('add', '-A');

	execFileSync('git', ['commit', '-q', '-m', subject], {
		cwd: repo,
		stdio: 'pipe',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: name,
			GIT_AUTHOR_EMAIL: email,
			GIT_COMMITTER_NAME: name,
			GIT_COMMITTER_EMAIL: email,
		},
	});
};

commit('first thing', 'Jonatan Lampa', 'jola@example.com');
commit('second thing', 'Jonatan Lampa', 'jola@example.com');
commit('older work', 'J. Lampa', 'j.lampa@oldjob.com');
commit('a colleagues change', 'Sam Rivers', 'sam@example.com');

console.log(`repo:   ${repo}`);
console.log(`config: ${globalDir}`);
console.log();

if (wantsGui && !existsSync(join(root, 'dist/gui/index.html'))) {
	console.error('The GUI bundle is missing — run `npm run build:gui` first.');
	process.exit(1);
}

// From source rather than dist, so it runs whatever is in the working tree and
// a change needs no build to try.
const entry = join(root, 'source/Index.tsx');
const args = [entry, ...(wantsGui ? ['gui'] : [])];

const child = spawn(join(root, 'node_modules/.bin/tsx'), args, {
	cwd: repo,
	stdio: 'inherit',
	env: {
		...process.env,
		EPIQ_GLOBAL_DIR: globalDir,
		// Only the GUI reads this, to find the bundle in dist/ rather than beside
		// its own module.
		IS_LOCAL: 'true',
	},
});

child.on('exit', code => process.exit(code ?? 0));
