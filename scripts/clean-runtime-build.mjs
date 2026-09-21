import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// TypeScript does not remove outputs whose source files were deleted. Clean
// only these generated runtime trees so removed adapters cannot ship again.
await Promise.all(['adapters', 'bootstrap', 'runtime', 'shared'].map(directory =>
  rm(fileURLToPath(new URL(`../dist/${directory}`, import.meta.url)), { recursive: true, force: true }),
));
