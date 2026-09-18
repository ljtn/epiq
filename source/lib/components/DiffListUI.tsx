import {Box, Text} from 'ink';
import React, {useEffect, useRef, useState} from 'react';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {RefCommitEntry, getCommitsForRef} from '../commits/commits.js';
import {isFieldNode, Ticket} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {timeAgo} from '../utils/date.utils.js';
import {nodeRef} from '../utils/node-ref.js';
import {virtualNodeId} from '../virtual-nodes/virtual-ids.js';
import {CommitDiffUI} from './CommitDiffUI.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	ticket: Ticket;
	width: number;
	height: number;
};

const getDiffRootNodeId = (ticketId: string) => virtualNodeId(ticketId, 'diff');

const detachCommitNodes = (commitNodes: NavNode<'FIELD'>[]) => {
	for (const node of commitNodes) {
		nodeRepo.deleteNode(node.id);
	}
};

// The sha is the node id, so both the editor hand-off and the pager can read
// it straight back off the node — the same trick the attachment list plays
// with its attachment ids.
//
// Vertical, because entering one opens its patch and the rows of a patch are
// navigated up and down.
const createCommitNode = (
	commit: RefCommitEntry,
	index: number,
	parentNodeId: string,
): NavNode<'FIELD'> =>
	nodes.field({
		id: commit.sha,
		name: commit.subject,
		parentNodeId,
		rank: String(index).padStart(6, '0'),
		childRenderAxis: 'vertical',
		isVirtual: true,
	});

const attachCommitNodes = (
	ticket: Ticket,
	commits: RefCommitEntry[],
): NavNode<'FIELD'>[] => {
	const rootNode = nodeRepo.getNode(getDiffRootNodeId(ticket.id));
	if (!rootNode || !isFieldNode(rootNode)) return [];

	const created = commits
		.map((commit, index) => createCommitNode(commit, index, rootNode.id))
		.map(node => nodeRepo.createNode(node))
		.filter(isSuccess)
		.map(({value}) => value)
		.filter(isFieldNode);

	if (commits.length > 0 && getState().selectedIndex < 0) {
		navigationUtils.navigate({contextNode: rootNode, selectedIndex: 0});
	}

	return created;
};

const formatChange = (commit: RefCommitEntry) =>
	`+${commit.insertions} -${commit.deletions}`;

type Load =
	| {state: 'loading'}
	| {state: 'failed'; message: string}
	| {state: 'loaded'; commits: RefCommitEntry[]};

export function DiffListUI({ticket, width, height}: Props) {
	const [load, setLoad] = useState<Load>({state: 'loading'});

	// Derived from the id rather than read off `props.ref`, which is optional —
	// the same way the GUI server asks this question.
	const ref = nodeRef(ticket.id);

	useEffect(() => {
		let current = true;

		setLoad({state: 'loading'});

		void getCommitsForRef({ref}).then(result => {
			// The ticket can change under a request that is still in flight, and
			// the answer belongs to whichever ticket asked for it.
			if (!current) return;

			setLoad(
				isFail(result)
					? {state: 'failed', message: result.message}
					: {state: 'loaded', commits: result.value},
			);
		});

		return () => {
			current = false;
		};
	}, [ref]);

	const commitNodesRef = useRef<NavNode<'FIELD'>[]>([]);
	const commits = load.state === 'loaded' ? load.commits : null;

	useEffect(() => {
		detachCommitNodes(commitNodesRef.current);

		commitNodesRef.current = commits ? attachCommitNodes(ticket, commits) : [];

		return () => {
			detachCommitNodes(commitNodesRef.current);
			commitNodesRef.current = [];
		};
	}, [ticket, commits]);

	const {selectedIndex, contextNode} = useAppState();

	// Entering a commit opens its patch. The list stays mounted underneath —
	// unmounting it would detach the very nav node the pager is now the context
	// of, and navigation would have nowhere to go back to.
	const openCommit =
		commits?.find(candidate => candidate.sha === contextNode.id) ?? null;

	const padding = 4;
	const scrollHeight = Math.max(1, height - padding);
	const subjectWidth = Math.max(12, width - 34);

	if (load.state !== 'loaded') {
		return (
			<Box flexDirection="column" width={width} height={height} padding={1}>
				<Text color={theme.primary}>
					{load.state === 'loading'
						? 'Reading commits…'
						: `Could not read commits: ${load.message}`}
				</Text>
			</Box>
		);
	}

	if (openCommit) {
		return (
			<CommitDiffUI
				ticket={ticket}
				sha={openCommit.sha}
				subject={openCommit.subject}
				width={width}
				height={height}
			/>
		);
	}

	if (load.commits.length === 0) {
		return (
			<Box flexDirection="column" width={width} height={height} padding={1}>
				<Text color={theme.primary}>No commits reference this ticket.</Text>
				<Box paddingTop={1}>
					<Text color={theme.primary}>Commits are matched by the</Text>
					<Text color={theme.accent}>{` ${ref} `}</Text>
					<Text color={theme.primary}>prefix on their subject line.</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Box
				paddingLeft={4}
				borderLeft={false}
				borderRight={false}
				borderBottom={false}
				borderTop={true}
				borderColor={theme.secondary}
				borderStyle="single"
				paddingBottom={1}
			>
				<Text color={theme.secondary2}>
					{`Diff (${load.commits.length}) — enter to read, o to open in your editor `}
				</Text>
			</Box>

			<ScrollBoxUI
				height={scrollHeight}
				itemHeight={2}
				selectedIndex={selectedIndex}
			>
				{load.commits.map((commit, index) => {
					const isSelected = index === selectedIndex;
					const subject =
						commit.subject.length > subjectWidth
							? commit.subject.slice(0, subjectWidth - 1) + '…'
							: commit.subject;

					return (
						<Box
							key={commit.sha}
							flexDirection="row"
							paddingX={1}
							paddingBottom={1}
						>
							<Text color={theme.accent}>{isSelected ? '❯ ' : '  '}</Text>
							<Box paddingLeft={1}>
								<Text color={theme.secondary2}>
									{`${commit.sha.slice(0, 7)} `}
								</Text>
								<Text color={isSelected ? theme.accent : theme.primary}>
									{subject}
								</Text>
								<Text color={theme.secondary2}>
									{`  ${formatChange(commit)}  ${timeAgo(commit.time)}`}
								</Text>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
