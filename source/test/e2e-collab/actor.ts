/**
 * One collaborator, in its own process.
 *
 * App state is a module singleton, so two actors cannot share a process. Each
 * gets its own clone and its own `EPIQ_GLOBAL_DIR` — where identity and the
 * state worktree live — while sharing the project id that is committed to the
 * repo. That is what a second machine actually looks like.
 *
 * Reads its job from argv, writes a report to disk, exits. It does not throw:
 * the orchestrator has to be able to tell a refusal from a crash.
 */
import fs from 'node:fs';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {syncEpiqWithRemote} from '../../git/sync.js';
import {loadSettingsFromConfig} from '../../lib/config/user-config.js';
import {createDefaultEvents} from '../../lib/event/event-boot.js';
import {loadMergedEvents} from '../../lib/event/event-load.js';
import {getPersistFileName, persist} from '../../lib/event/event-persist.js';
import {isFail} from '../../lib/model/result-types.js';
import {patchSettingsState} from '../../lib/state/settings.state.js';
import {
	addIssueComment,
	addIssueTag,
	closeIssue,
	createIssue,
	listIssues,
	listSwimlanes,
} from '../../mcp/epiq-api.js';
import {readEventIds, readOwnEventIds} from './log-reader.js';
import type {ActorJob, ActorReport} from './protocol.js';

const job = JSON.parse(process.argv[2] ?? '{}') as ActorJob;
const problems: string[] = [];

const settings = loadSettingsFromConfig();
if (isFail(settings)) problems.push(`settings: ${settings.message}`);
else patchSettingsState(settings.value);

const actor = {userId: job.userId, userName: job.userName};

// What `init` does, minus the TUI it is wired into: the first sync creates the
// state branch and its worktree, then the default events give the board a
// workspace and a swimlane to put issues in.
if (job.init) {
	const bootstrap = await syncEpiqWithRemote({
		cwd: job.repoRoot,
		ownEventFileName: getPersistFileName(actor),
	});
	if (isFail(bootstrap)) problems.push(`bootstrap: ${bootstrap.message}`);

	const root = getStateBranchRoot({repoRoot: job.repoRoot});
	const defaults = createDefaultEvents(actor);

	if (isFail(root)) problems.push(`state root: ${root.message}`);
	else if (isFail(defaults)) problems.push(`defaults: ${defaults.message}`);
	else {
		for (const event of defaults.value) {
			const written = persist({event, rootDir: root.value});
			if (isFail(written)) problems.push(`persist: ${written.message}`);
		}
	}
}

const swimlanes = await listSwimlanes({repoRoot: job.repoRoot});
const swimlaneId = isFail(swimlanes)
	? null
	: (swimlanes.value as {id: string}[])[0]?.id ?? null;

if (swimlaneId === null) {
	problems.push(
		`no swimlane to work in${
			isFail(swimlanes) ? `: ${swimlanes.message}` : ''
		}`,
	);
}

for (const action of swimlaneId === null ? [] : job.actions) {
	const result =
		action.kind === 'create'
			? await createIssue({
					repoRoot: job.repoRoot,
					parentId: swimlaneId ?? '',
					title: action.title,
			  })
			: action.kind === 'comment'
			? await addIssueComment({
					repoRoot: job.repoRoot,
					issueId: action.issueId,
					body: action.body,
			  })
			: action.kind === 'tag'
			? await addIssueTag({
					repoRoot: job.repoRoot,
					issueId: action.issueId,
					tagName: action.tagName,
			  })
			: await closeIssue({
					repoRoot: job.repoRoot,
					issueId: action.issueId,
			  });

	if (isFail(result)) problems.push(`${action.kind}: ${result.message}`);
}

if (job.sync) {
	const synced = await syncEpiqWithRemote({
		cwd: job.repoRoot,
		ownEventFileName: getPersistFileName(actor),
	});

	if (isFail(synced)) problems.push(`sync: ${synced.message}`);
}

const stateRoot = getStateBranchRoot({repoRoot: job.repoRoot});
const issues = await listIssues({repoRoot: job.repoRoot});

// Straight from the loader, so this is the causal order the board is built
// from rather than anything the harness decides.
const loaded = isFail(stateRoot) ? null : loadMergedEvents(stateRoot.value);

if (loaded && isFail(loaded)) problems.push(`load: ${loaded.message}`);

const orderedIds =
	loaded && !isFail(loaded) ? loaded.value.map(event => event.id) : [];

const report: ActorReport = {
	userId: job.userId,
	problems,
	authoredEventIds: isFail(stateRoot)
		? []
		: readOwnEventIds(stateRoot.value, getPersistFileName(actor)),
	seenEventIds: isFail(stateRoot) ? [] : readEventIds(stateRoot.value),
	orderedEventIds: orderedIds,
	issues: isFail(issues)
		? []
		: (issues.value as {id: string; title: string}[])
				.map(issue => `${issue.id}\t${issue.title}`)
				.sort(),
};

fs.writeFileSync(job.reportPath, JSON.stringify(report, null, 2));
