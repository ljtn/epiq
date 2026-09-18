import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {theme} from '../theme/themes.js';
import {getStateBranch} from '../../git/git-constants.js';
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

/**
 * The addresses the setup step is asking about, drawn where it asks.
 *
 * The command returns this list too, but a successful command's message is
 * discarded — the TUI shows failures and nothing else — so the list has to be
 * on screen for the numbers in `:config emails 1,2` to refer to anything.
 * State lives where it is drawn.
 */
export const EmailCandidates: React.FC = () => {
	const [candidates, setCandidates] = useState<EmailCandidate[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;

		const load = async () => {
			const stateResult = getSafeState();
			const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());

			if (isFail(stateResult) || isFail(repoRootResult)) return;

			const branchResult = getStateBranch(repoRootResult.value);
			const {userName, gitEmail} = getSettingsState();

			const found = await findEmailCandidates({
				repoRoot: repoRootResult.value,
				stateBranch: isFail(branchResult) ? undefined : branchResult.value,
				names: [userName, gitEmail],
				links: stateResult.value.emailLinks,
			});

			if (!live) return;

			if (isFail(found)) {
				setError(found.message);
				return;
			}

			const offerable = offerableCandidates(found.value);

			// Recorded for the command line, which completes and validates against
			// exactly what is on screen.
			setOfferedEmails(offerable.map(candidate => candidate.email));
			setCandidates(offerable);
		};

		void load();

		return () => {
			live = false;
		};
	}, []);

	if (error) {
		return (
			<Box marginTop={1}>
				<Text color={theme.red}>{error}</Text>
			</Box>
		);
	}

	if (candidates === null) return null;

	if (candidates.length === 0) {
		return (
			<Box marginTop={1}>
				<Text color={theme.secondary2}>
					No unclaimed addresses in this history — type
					<Text color={theme.accent}> :config emails none </Text>
					to move on.
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			{candidates.map(candidate => (
				<Text key={candidate.email}>
					<Text color={theme.accent}>{'  · '}</Text>
					<Text>{candidate.email}</Text>
					<Text color={theme.secondary2}>
						{`  ${candidate.commits} commit${
							candidate.commits === 1 ? '' : 's'
						} as ${candidate.names.join(', ') || 'unknown'}`}
					</Text>
				</Text>
			))}
			<Box marginTop={1}>
				<Text color={theme.secondary2}>
					Claim yours by address, or
					<Text color={theme.accent}> none </Text>
					to skip.
				</Text>
			</Box>
		</Box>
	);
};
