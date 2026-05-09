import {Box, Text} from 'ink';
import React from 'react';
import {isTicketNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {FieldNames} from '../repository/fielNames.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {CursorUI} from './Cursor.js';
import {TagUI} from './Tag.js';

type Props = {
	parent: NavNode<'FIELD_LIST'>;
	selectedIndex: number;
	selected: boolean;
};

export const FieldListUI: React.FC<Props> = ({
	selectedIndex,
	parent,
	selected,
}) => {
	const {currentNode} = useAppState();
	const {title} = parent;

	const ticket = parent.parentNodeId
		? nodeRepo.getNode(parent.parentNodeId)
		: undefined;

	const items =
		ticket && isTicketNode(ticket)
			? title === FieldNames.ASSIGNEES
				? ticket.props.assignees ?? []
				: title === FieldNames.TAGS
				? ticket.props.tags ?? []
				: []
			: [];

	return (
		<Box alignItems="center" paddingTop={1}>
			<Box minWidth={12}>
				<CursorUI isSelected={selected} />
				<Text color={selected ? theme.accent : theme.secondary2}>{title}:</Text>
			</Box>

			<Box flexDirection="row" marginLeft={1} paddingRight={1}>
				{items.map((item, index) => {
					const isSelected =
						currentNode.id === parent.id && index === selectedIndex;

					return (
						<Box key={`${title}-${item}`} paddingRight={2} minHeight={1}>
							<CursorUI isSelected={isSelected} />

							{title === FieldNames.ASSIGNEES ? (
								<AssigneeUI isSelected={isSelected} id={item} />
							) : title === FieldNames.TAGS ? (
								<TagUI isSelected={isSelected} id={item} />
							) : null}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
};
