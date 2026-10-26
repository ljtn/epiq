// Import-free so the browser client can reach it: these facts must agree
// across the GUI, the blob route and attachment markdown.

// Where the GUI serves blobs from. Kept beside the markdown builder so the
// reference and the route that answers it stay one fact.
export const ATTACHMENT_URL_PREFIX = '/media/';

export const getAttachmentUrl = (fileName: string): string =>
	`${ATTACHMENT_URL_PREFIX}${fileName}`;

/** The markdown that renders an attachment inline in a comment or description. */
export const getAttachmentMarkdown = (name: string, fileName: string): string =>
	`![${name}](${getAttachmentUrl(fileName)})`;
