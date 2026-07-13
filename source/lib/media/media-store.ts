import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
	ATTACHMENT_EXTENSIONS,
	AttachmentExt,
} from '../model/app-state.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getMediaDirPath} from '../storage/paths.js';

export const DEFAULT_ATTACHMENT_MAX_KB = 500;

/**
 * Content-addressed blob filename: sha256 hex + whitelisted extension.
 * The strict shape doubles as path-traversal protection wherever a
 * hash/ext pair is turned into a filesystem path.
 */
const BLOB_FILE_PATTERN = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;

export const getAttachmentFileName = (
	hash: string,
	ext: AttachmentExt,
): string => `${hash}.${ext}`;

export const isValidAttachmentFileName = (fileName: string): boolean =>
	BLOB_FILE_PATTERN.test(fileName);

/**
 * Determines the image type from the file's magic bytes. Extensions and
 * MIME types arriving over sync or an API are never trusted — synced blobs
 * come from anyone who can push to the repo.
 */
export const sniffImageExt = (data: Buffer): Result<AttachmentExt> => {
	if (
		data.length >= 8 &&
		data
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	) {
		return succeeded('Sniffed image type', 'png');
	}

	if (
		data.length >= 3 &&
		data[0] === 0xff &&
		data[1] === 0xd8 &&
		data[2] === 0xff
	) {
		return succeeded('Sniffed image type', 'jpg');
	}

	if (
		data.length >= 6 &&
		(data.subarray(0, 6).equals(Buffer.from('GIF87a', 'ascii')) ||
			data.subarray(0, 6).equals(Buffer.from('GIF89a', 'ascii')))
	) {
		return succeeded('Sniffed image type', 'gif');
	}

	if (
		data.length >= 12 &&
		data.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii')) &&
		data.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii'))
	) {
		return succeeded('Sniffed image type', 'webp');
	}

	return failed(
		`Unsupported image format. Allowed: ${ATTACHMENT_EXTENSIONS.join(', ')}`,
	);
};

export const hashAttachmentData = (data: Buffer): string =>
	crypto.createHash('sha256').update(data).digest('hex');

export type ValidatedAttachment = {
	hash: string;
	ext: AttachmentExt;
	bytes: number;
};

/**
 * Validates raw attachment bytes: magic-byte sniffing and the size cap.
 * Returns the content hash and detected extension on success.
 */
export const validateAttachmentData = (
	data: Buffer,
	maxKb = DEFAULT_ATTACHMENT_MAX_KB,
): Result<ValidatedAttachment> => {
	if (data.length === 0) {
		return failed('Attachment is empty');
	}

	if (data.length > maxKb * 1024) {
		return failed(
			`Attachment exceeds the ${maxKb} KB size cap (${Math.ceil(
				data.length / 1024,
			)} KB)`,
		);
	}

	const extResult = sniffImageExt(data);
	if (isFail(extResult)) return extResult;

	return succeeded('Validated attachment data', {
		hash: hashAttachmentData(data),
		ext: extResult.value,
		bytes: data.length,
	});
};

/**
 * Validates and writes an attachment blob into the state branch media dir.
 * Content addressing makes writes idempotent: identical images dedupe to
 * the same file and concurrent writers can never conflict.
 */
export const writeAttachmentBlob = (
	stateBranchRoot: string,
	data: Buffer,
	maxKb = DEFAULT_ATTACHMENT_MAX_KB,
): Result<ValidatedAttachment> => {
	const validated = validateAttachmentData(data, maxKb);
	if (isFail(validated)) return validated;

	const mediaDir = getMediaDirPath(stateBranchRoot);
	const filePath = path.join(
		mediaDir,
		getAttachmentFileName(validated.value.hash, validated.value.ext),
	);

	try {
		if (!fs.existsSync(filePath)) {
			fs.mkdirSync(mediaDir, {recursive: true});
			fs.writeFileSync(filePath, data);
		}
	} catch (error) {
		return failed(
			`Unable to write attachment blob: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	return succeeded('Wrote attachment blob', validated.value);
};

/**
 * Resolves a blob path for reading/serving. Rejects anything that is not a
 * well-formed content-addressed filename, verifies the file exists, and —
 * because synced blobs are untrusted input — recomputes the hash and
 * requires it to match the filename.
 */
export const resolveAttachmentBlob = (
	stateBranchRoot: string,
	fileName: string,
	maxKb = DEFAULT_ATTACHMENT_MAX_KB,
): Result<{filePath: string; ext: AttachmentExt; bytes: number}> => {
	if (!isValidAttachmentFileName(fileName)) {
		return failed('Invalid attachment file name');
	}

	const filePath = path.join(getMediaDirPath(stateBranchRoot), fileName);
	if (!fs.existsSync(filePath)) {
		return failed('Attachment blob not found');
	}

	let data: Buffer;
	try {
		data = fs.readFileSync(filePath);
	} catch (error) {
		return failed(
			`Unable to read attachment blob: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (data.length > maxKb * 1024) {
		return failed(
			`Attachment exceeds the ${maxKb} KB size cap and will not be served`,
		);
	}

	const [expectedHash, ext] = fileName.split('.') as [string, AttachmentExt];
	if (hashAttachmentData(data) !== expectedHash) {
		return failed('Attachment blob does not match its content hash');
	}

	const sniffed = sniffImageExt(data);
	if (isFail(sniffed)) return sniffed;
	if (sniffed.value !== ext) {
		return failed('Attachment blob content does not match its extension');
	}

	return succeeded('Resolved attachment blob', {
		filePath,
		ext,
		bytes: data.length,
	});
};
