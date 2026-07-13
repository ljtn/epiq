import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	getAttachmentFileName,
	hashAttachmentData,
	isValidAttachmentFileName,
	resolveAttachmentBlob,
	sniffImageExt,
	validateAttachmentData,
	writeAttachmentBlob,
} from '../lib/media/media-store.js';
import {isFail} from '../lib/model/result-types.js';
import {getMediaDirPath} from '../lib/storage/paths.js';

const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
);
const JPEG_HEADER = Buffer.concat([
	Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
	Buffer.from('fakejpegbody'),
]);
const GIF_HEADER = Buffer.concat([
	Buffer.from('GIF89a', 'ascii'),
	Buffer.from([0x01, 0x00, 0x01, 0x00]),
]);
const WEBP_HEADER = Buffer.concat([
	Buffer.from('RIFF', 'ascii'),
	Buffer.from([0x10, 0x00, 0x00, 0x00]),
	Buffer.from('WEBP', 'ascii'),
	Buffer.from('VP8 ', 'ascii'),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('sniffImageExt', () => {
	it('detects png', () => {
		const result = sniffImageExt(PNG_1PX);
		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe('png');
	});

	it('detects jpg', () => {
		const result = sniffImageExt(JPEG_HEADER);
		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe('jpg');
	});

	it('detects gif', () => {
		const result = sniffImageExt(GIF_HEADER);
		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe('gif');
	});

	it('detects webp', () => {
		const result = sniffImageExt(WEBP_HEADER);
		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe('webp');
	});

	it('rejects svg — an xss vector, never renderable', () => {
		expect(isFail(sniffImageExt(SVG))).toBe(true);
	});

	it('rejects arbitrary bytes', () => {
		expect(isFail(sniffImageExt(Buffer.from('just some text')))).toBe(true);
	});
});

describe('validateAttachmentData', () => {
	it('accepts a valid image under the cap', () => {
		const result = validateAttachmentData(PNG_1PX);
		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value.ext).toBe('png');
		expect(result.value.bytes).toBe(PNG_1PX.length);
		expect(result.value.hash).toBe(hashAttachmentData(PNG_1PX));
	});

	it('rejects empty data', () => {
		expect(isFail(validateAttachmentData(Buffer.alloc(0)))).toBe(true);
	});

	it('rejects data over the size cap', () => {
		const oversized = Buffer.concat([PNG_1PX, Buffer.alloc(600 * 1024)]);
		const result = validateAttachmentData(oversized, 500);
		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('size cap');
	});

	it('respects a custom cap', () => {
		const result = validateAttachmentData(PNG_1PX, 1);
		expect(isFail(result)).toBe(false);
	});
});

describe('isValidAttachmentFileName', () => {
	const validHash = 'a'.repeat(64);

	it('accepts content-addressed names', () => {
		expect(isValidAttachmentFileName(`${validHash}.png`)).toBe(true);
		expect(isValidAttachmentFileName(`${validHash}.webp`)).toBe(true);
	});

	it('rejects traversal, wrong hashes, and foreign extensions', () => {
		expect(isValidAttachmentFileName('../../../etc/passwd')).toBe(false);
		expect(isValidAttachmentFileName(`${validHash}.svg`)).toBe(false);
		expect(isValidAttachmentFileName(`${'A'.repeat(64)}.png`)).toBe(false);
		expect(isValidAttachmentFileName('short.png')).toBe(false);
		expect(isValidAttachmentFileName(`${validHash}.png.exe`)).toBe(false);
	});
});

describe('writeAttachmentBlob / resolveAttachmentBlob', () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-media-'));
	});

	afterEach(() => {
		fs.rmSync(root, {recursive: true, force: true});
	});

	it('writes a content-addressed blob and resolves it back', () => {
		const written = writeAttachmentBlob(root, PNG_1PX);
		expect(isFail(written)).toBe(false);
		if (isFail(written)) return;

		const fileName = getAttachmentFileName(
			written.value.hash,
			written.value.ext,
		);
		expect(fs.existsSync(path.join(getMediaDirPath(root), fileName))).toBe(
			true,
		);

		const resolved = resolveAttachmentBlob(root, fileName);
		expect(isFail(resolved)).toBe(false);
		if (isFail(resolved)) return;
		expect(resolved.value.ext).toBe('png');
		expect(resolved.value.bytes).toBe(PNG_1PX.length);
	});

	it('is idempotent for identical content', () => {
		expect(isFail(writeAttachmentBlob(root, PNG_1PX))).toBe(false);
		expect(isFail(writeAttachmentBlob(root, PNG_1PX))).toBe(false);

		const files = fs.readdirSync(getMediaDirPath(root));
		expect(files).toHaveLength(1);
	});

	it('rejects oversized data at write time', () => {
		const oversized = Buffer.concat([PNG_1PX, Buffer.alloc(600 * 1024)]);
		expect(isFail(writeAttachmentBlob(root, oversized))).toBe(true);
	});

	it('refuses to resolve a blob whose content does not match its hash', () => {
		// simulate a spoofed synced blob: valid name, foreign content
		const fileName = `${'b'.repeat(64)}.png`;
		fs.mkdirSync(getMediaDirPath(root), {recursive: true});
		fs.writeFileSync(path.join(getMediaDirPath(root), fileName), PNG_1PX);

		const result = resolveAttachmentBlob(root, fileName);
		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('content hash');
	});

	it('refuses to resolve a blob whose bytes do not match its extension', () => {
		const hash = hashAttachmentData(PNG_1PX);
		const fileName = `${hash}.jpg`;
		fs.mkdirSync(getMediaDirPath(root), {recursive: true});
		fs.writeFileSync(path.join(getMediaDirPath(root), fileName), PNG_1PX);

		const result = resolveAttachmentBlob(root, fileName);
		expect(isFail(result)).toBe(true);
	});

	it('refuses invalid file names outright', () => {
		expect(isFail(resolveAttachmentBlob(root, '../secrets.png'))).toBe(true);
		expect(isFail(resolveAttachmentBlob(root, 'nope'))).toBe(true);
	});

	it('reports missing blobs', () => {
		const result = resolveAttachmentBlob(root, `${'c'.repeat(64)}.png`);
		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('not found');
	});
});
