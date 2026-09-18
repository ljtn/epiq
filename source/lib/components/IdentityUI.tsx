import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {getStateBranch} from '../../git/git-constants.js';
import {claimantsOf, emailsOf} from '../model/email-link.js';
import {isFail} from '../model/result-types.js';
import {
	EmailCandidate,
	findEmailCandidates,
	offerableCandidates,
} from '../repository/email-candidates.js';
import {setOfferedEmails} from '../state/email-offers.state.js';
import {getSettingsState} from '../state/settings.state.js';
import {getSafeState} from '../state/state.js';
import {resolveClosestEpiqProjectRoot} from '../storage/paths.js';
import {theme} from '../theme/themes.js';

// Who the board thinks you are, and which git addresses carry your commits.
//
// Setup asks the question once; this is where it is answered again afterwards.
// Without it the TUI could claim an address exactly once, during setup, and a
// person who changed jobs or declined at the time had no way back.

type Claimed = {email: string; others: string[]};

const Row = ({
	index,
	email,
	note,
	noteColor,
}: {
	index?: number;
	email: string;
	note?: string;
	noteColor?: string;
}) => (
	<Box>
		<Text color={theme.accent}>
			{index === undefined ? '   ' : `  ${index}.`}
		</Text>
		<Text> {email}</Text>
		{note && <Text color={noteColor ?? theme.secondary2}>{`  ${note}`}</Text>}
	</Box>
);

export const IdentityUI: React.FC<{width: number; height: number}> = ({
	height,
}) => {
	const [claimed, setClaimed] = useState<Claimed[]>([]);
	const [offered, setOffered] = useState<EmailCandidate[]>([]);
	const [error, setError] = useState<string | null>(null);
	const {userName, gitEmail, gitName, userId} = getSettingsState();

	useEffect(() => {
		let live = true;

		const load = async () => {
			const stateResult = getSafeState();
			const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());

			if (isFail(stateResult) || isFail(repoRootResult) || !userId) return;

			const links = stateResult.value.emailLinks;

			const mine = emailsOf(links, userId);

			setClaimed(
				mine.map(email => ({
					email,
					others: claimantsOf(links, email)
						.filter(id => id !== userId)
						.map(id => stateResult.value.contributors[id]?.name ?? id),
				})),
			);

			const branchResult = getStateBranch(repoRootResult.value);
			const found = await findEmailCandidates({
				repoRoot: repoRootResult.value,
				stateBranch: isFail(branchResult) ? undefined : branchResult.value,
				names: [userName, gitName],
				links,
			});

			if (!live) return;

			if (isFail(found)) {
				setError(found.message);
				return;
			}

			const offerable = offerableCandidates(found.value);

			// The command line completes and validates against exactly what is
			// drawn here, so the numbers on screen are the numbers it counts.
			setOfferedEmails(offerable.map(candidate => candidate.email));
			setOffered(offerable);
		};

		void load();

		return () => {
			live = false;
		};
	}, [userId, userName, gitName, gitEmail]);

	return (
		<Box
			height={height - 4}
			flexDirection="column"
			paddingTop={1}
			paddingLeft={2}
			borderStyle="round"
			borderColor={theme.secondary}
			rowGap={1}
		>
			<Box>
				<Text color={theme.accent} bold>
					{userName ?? 'Not configured'}
				</Text>
				<Text color={theme.secondary2}> on this board</Text>
			</Box>

			{error && <Text color={theme.red}>{error}</Text>}

			<Box flexDirection="column">
				<Text color={theme.secondary2}>CLAIMED</Text>
				{claimed.length === 0 ? (
					<Row
						email="Nothing claimed — your commits show the name git signed them with."
						note=""
					/>
				) : (
					claimed.map(row => (
						<Row
							key={row.email}
							email={row.email}
							note={
								row.others.length > 0
									? `CONTESTED: also ${row.others.join(
											', ',
									  )}, resolves to nobody`
									: row.email === gitEmail
									? 'your git identity here'
									: undefined
							}
							noteColor={row.others.length > 0 ? theme.yellow : undefined}
						/>
					))
				)}
			</Box>

			<Box flexDirection="column">
				<Text color={theme.secondary2}>UNCLAIMED IN THIS HISTORY</Text>
				{offered.length === 0 ? (
					<Row email="Nothing left to claim here." />
				) : (
					offered.map(candidate => (
						<Row
							key={candidate.email}
							email={candidate.email}
							note={`${candidate.commits} commit${
								candidate.commits === 1 ? '' : 's'
							} as ${candidate.names.join(', ') || 'unknown'}`}
						/>
					))
				)}
			</Box>

			<Box flexDirection="column">
				{/* "claims, ready to edit" read as though the claim happened and
				    could be changed afterwards. It does not: enter writes the
				    command into the line, and nothing is claimed until it is
				    confirmed. */}
				<Text color={theme.secondary2}>
					<Text color={theme.accent}>[enter]</Text> writes a claim for the first
					into the command line, to confirm or change.
				</Text>
				<Text color={theme.secondary2}>
					<Text color={theme.accent}>:config emails</Text> claims by address,
					<Text color={theme.accent}> :config emails-unclaim </Text>
					gives one back.
				</Text>
				<Text color={theme.secondary2}>
					<Text color={theme.accent}>[esc]</Text> to close
				</Text>
			</Box>
		</Box>
	);
};
