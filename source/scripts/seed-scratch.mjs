// Seeds a throwaway epiq project for manual verification, so nothing is ever
// tested against the repo's own board. Prints the project root and the
// EPIQ_GLOBAL_DIR the GUI must run with.
import {seedProject} from '../test/e2e-gui/seed-tui.ts';

const cwd = await seedProject();

console.log(`PROJECT_ROOT=${cwd}`);
console.log(`EPIQ_GLOBAL_DIR=${process.env['EPIQ_GLOBAL_DIR']}`);
