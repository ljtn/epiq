import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {ulid} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {isTextNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {ScrollBoxUI} from './ScrollBox.js';

type HelpItem = {
	keys: string;
	action: string;
};

const HELP_ROOT_ID = ulid();

const getHelpItems = (): HelpItem[] =>
	[
		...new Set(
			[...getState().availableActions]
				.map(action => action.description)
				.filter(
					(description): description is string => description !== undefined,
				),
		),
	]
		.map(desc => {
			const [leftRaw, rightRaw] = desc.split(']');
			const keys = leftRaw?.replace('[', '');
			const action = rightRaw?.trim();

			return [keys, action];
		})
		.filter(
			(entry): entry is [string, string] =>
				entry[0] !== undefined && entry[1] !== undefined,
		)
		.sort(([a], [b]) => {
			if (a.length === 1 && b.length !== 1) return -1;
			if (a.length !== 1 && b.length === 1) return 1;

			return a.localeCompare(b, undefined, {sensitivity: 'base'});
		})
		.map(([keys, action]) => ({keys, action}));

const createHelpRootNode = (parentNodeId: string): NavNode<'TEXT'> =>
	nodes.text({
		id: HELP_ROOT_ID,
		parentNodeId,
		rank: '000000',
		name: 'Help',
		props: {},
		isVirtual: true,
		readonly: true,
	});

const createHelpNode = (
	item: HelpItem,
	index: number,
	parentNodeId: string,
): NavNode<'TEXT'> =>
	nodes.text({
		id: ulid(),
		parentNodeId,
		rank: String(index).padStart(6, '0'),
		name: item.keys,
		props: {
			value: item.action,
		},
		readonly: true,
		isVirtual: true,
	});

let helpNodes: NavNode<'TEXT'>[] = [];

const detachHelpNodes = () => {
	const childIds = helpNodes
		.filter(node => node.id !== HELP_ROOT_ID)
		.map(node => node.id);

	const rootIds = helpNodes
		.filter(node => node.id === HELP_ROOT_ID)
		.map(node => node.id);

	helpNodes = [];

	for (const id of [...childIds, ...rootIds]) {
		nodeRepo.deleteNode(id);
	}
};

const attachHelpNodes = (items: HelpItem[]) => {
	detachHelpNodes();

	const rootNodeResult = nodeRepo.createNode(
		createHelpRootNode(getState().rootNodeId),
	);

	if (isFail(rootNodeResult) || !isTextNode(rootNodeResult.value))
		return logger.error('Could not attach help nodes');

	helpNodes = [
		rootNodeResult.value,
		...items
			.map((item, i) => createHelpNode(item, i, HELP_ROOT_ID))
			.map(nodeRepo.createNode)
			.filter(isSuccess)
			.map(({value}) => value)
			.filter(isTextNode),
	];

	navigationUtils.navigate({
		contextNode: rootNodeResult.value,
		selectedIndex: 0,
	});
};

export const HelpUI: React.FC<{width: number; height: number}> = ({
	width,
	height,
}) => {
	const items = useMemo(() => getHelpItems(), []);

	useEffect(() => {
		attachHelpNodes(items);

		return () => {
			detachHelpNodes();
		};
	}, [items]);

	const selectedIndex = getState().selectedIndex;

	return (
		<Box
			flexDirection="column"
			marginTop={3}
			borderColor={theme.secondary}
			borderStyle="round"
			width={width}
			height={height - 2}
		>
			<Box paddingX={1} justifyContent="center">
				<Text color={theme.accent}>Help</Text>
				<Text dimColor> — navigate with arrows/hjkl, press q to close</Text>
			</Box>

			<Box paddingX={1} marginTop={1}>
				<Box width={20} justifyContent="flex-end">
					<Text color={theme.secondary}>Key(s)</Text>
				</Box>

				<Box flexGrow={1} width={40} paddingLeft={2}>
					<Text color={theme.secondary}>Action</Text>
				</Box>
			</Box>

			<ScrollBoxUI
				height={height - 7}
				itemHeight={1}
				selectedIndex={selectedIndex}
			>
				{items.map(({keys, action}, index) => {
					const isSelected = index === selectedIndex;

					return (
						<Box
							paddingX={1}
							key={`${keys}-${action}-${index}`}
							flexDirection="row"
						>
							<Box width={20} justifyContent="flex-end">
								<Text color={theme.accent}>{keys}</Text>
							</Box>

							<Box flexGrow={1} width={40} paddingLeft={2}>
								<Text color={isSelected ? theme.primary : theme.secondary2}>
									{action}
								</Text>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
};
