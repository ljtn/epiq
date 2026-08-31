// Import-free so the browser client can reach it, like text.limits.ts. These
// three facts have to agree across the GUI, the server route that answers a
// blob and the markdown an attachment is referenced by, and media-store.ts —
// where they used to live — cannot be imported here: it pulls in node:crypto
// and node:fs, which the client bundle has no answer for.

// Where the GUI serves blobs from. Kept beside the markdown builder so the
// reference and the route that answers it stay one fact.
export const ATTACHMENT_URL_PREFIX = '/media/';

export const getAttachmentUrl = (fileName: string): string =>
	`${ATTACHMENT_URL_PREFIX}${fileName}`;

/**
 * The markdown that renders an attachment inline wherever a body is drawn as
 * markdown — a comment or a description. Handed back by the API that created
 * the attachment so a caller never has to build the path itself.
 */
export const getAttachmentMarkdown = (name: string, fileName: string): string =>
	`![${name}](${getAttachmentUrl(fileName)})`;
