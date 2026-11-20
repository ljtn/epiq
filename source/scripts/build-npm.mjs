#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import * as esbuild from 'esbuild';
import {npmBuildOptions} from './npm-build-options.mjs';
import {writeThirdPartyLicenses} from './third-party-licenses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const {metafile} = await esbuild.build(npmBuildOptions(root));
writeThirdPartyLicenses(
	root,
	metafile,
	resolve(root, 'dist/THIRD_PARTY_LICENSES.txt'),
);
