const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'out/extension.js',
  external: ['vscode'],
  sourcemap: true,
  sourcesContent: false,
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    return;
  }

  await esbuild.build(buildOptions);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
