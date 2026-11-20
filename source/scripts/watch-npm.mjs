import * as esbuild from 'esbuild';
import {npmBuildOptions} from './npm-build-options.mjs';

const context = await esbuild.context(npmBuildOptions(process.cwd()));

await context.watch();

console.log('Watching npm build...');
