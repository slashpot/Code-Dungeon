import esbuild from 'esbuild';

const common = {
  bundle: true,
  format: 'iife',
  logLevel: 'info',
  alias: { vm: './src/runtime/vm-stub.cjs' },
  define: { 'process.env.NODE_ENV': '"production"' },
};

await esbuild.build({
  ...common,
  entryPoints: ['src/main.js', 'src/runtime/worker.js'],
  outdir: 'dist',
});

// M2 才接線的模組先做語法/依賴檢查（不落地），避免爛在倉庫裡沒人發現
await esbuild.build({
  ...common,
  entryPoints: ['src/runtime/runner.js', 'src/ide/editor.js'],
  outdir: 'dist-check',
  write: false,
});
