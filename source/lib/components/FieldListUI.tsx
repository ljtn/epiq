import {Box, Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../../repository/node-repo.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {CursorUI} from './Cursor.js';

type Props = {
	parent: NavNode<AnyContext>;
	selectedIndex: number;
	selected: boolean;
};

export const FieldListUI: React.FC<Props> = ({
	selectedIndex,
	parent,
	selected,
}) => {
	const {title} = parent;
	const items = getOrderedChildren(parent.id)
		.map(item => {
			const refId =
				typeof item.props?.value === 'string' ? item.props.value : '';

			if (title === 'Assignees') return nodeRepo.getContributor(refId)?.id;

			if (title === 'Tags') return nodeRepo.getTag(refId)?.id;

			return undefined;
		})
		.filter((s): s is string => Boolean(s));

	return (
		<Box alignItems="center" paddingTop={1}>
			<Box minWidth={16}>
				<CursorUI isSelected={selected}></CursorUI>
				<Text color={selected ? theme.accent : theme.secondary}>{title}:</Text>
			</Box>

			<Box flexDirection="row" marginLeft={1} paddingRight={1} paddingLeft={1}>
				{items.map((item, index) => {
					const {currentNode} = useAppState();
					const isSelected =
						currentNode.id === parent.id && index === selectedIndex;

					return (
						<Box key={`${title}-${item}`} paddingRight={2} minHeight={1}>
							<CursorUI isSelected={isSelected}></CursorUI>

							{title === 'Assignees' ? (
								<AssigneeUI isSelected={isSelected} id={item} />
							) : title === 'Tags' ? (
								<TagUI isSelected={isSelected} id={item} />
							) : null}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
};
