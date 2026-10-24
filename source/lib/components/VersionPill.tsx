import chalk from 'chalk';
import {Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {EPIQ_VERSION} from '../../version.js';
import {theme} from '../theme/themes.js';
import {getVersionStatus, VersionStatus} from '../version/version-check.js';

const renderVersionDiff = (current: string, latest: string) => {
	const c = current.split('.');
	const l = latest.split('.');

	const diffStartIndex = l.findIndex((x, i) => x != c[i]);

	return l
		.map((x, i) =>
			i >= diffStartIndex
				? chalk.hex(theme.accent).dim(x)
				: chalk.hex(theme.secondary).dim(x),
		)
		.join(chalk.hex(theme.secondary2).dim('.'));
};

export function VersionPill() {
	const [versionStatus, setVersionStatus] = useState<VersionStatus>({
		current: EPIQ_VERSION,
		latest: null,
		updateAvailable: false,
	});

	useEffect(() => {
		let mounted = true;

		void getVersionStatus(EPIQ_VERSION).then(status => {
			if (mounted) {
				setVersionStatus(status);
			}
		});

		return () => {
			mounted = false;
		};
	}, []);

	if (!versionStatus.updateAvailable || !versionStatus.latest) {
		return (
			<Text dimColor color={theme.secondary2}>
				{EPIQ_VERSION + ' '}
			</Text>
		);
	}

	return (
		<Text>
			{chalk.hex(theme.secondary2).dim(EPIQ_VERSION)}
			{chalk.hex(theme.accent).dim(' ↗ ')}
			{renderVersionDiff(EPIQ_VERSION, versionStatus.latest)}
		</Text>
	);
}
