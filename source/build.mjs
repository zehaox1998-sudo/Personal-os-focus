import { mkdir, cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
await rm('dist', {recursive:true,force:true});
await mkdir('dist', {recursive:true});
await cp('public','dist',{recursive:true});
await build({entryPoints:['public/app.mjs'],bundle:true,outfile:'dist/app.mjs',format:'esm',platform:'browser',target:'es2022',minify:true});
