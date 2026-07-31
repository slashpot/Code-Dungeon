import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.js', 'src/worker.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  alias: { vm: './src/vm-stub.cjs' },
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
});
