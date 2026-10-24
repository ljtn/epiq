// Types only, so the GUI client can read them without pulling in Node.

export type VersionStatus = {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
};

export type ReleaseSection = {title: string | null; items: string[]};

export type Release = {
	version: string;
	url: string;
	publishedAt: string | null;
	sections: ReleaseSection[];
};

/** What the GUI shows of a newer epiq: the releases since this one, newest first. */
export type UpdateInfo = VersionStatus & {
	releases: Release[];
	// When the running version was published, where its release was found.
	currentPublishedAt: string | null;
	// The install script first; npm for whoever installed with it.
	commands: {script: string; npm: string};
};
