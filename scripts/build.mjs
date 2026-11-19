import {cp,mkdir,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for(const path of ['index.html','styles.css','app.js','engine.js','data']) await cp(path,`dist/${path}`,{recursive:true});
await cp('favicon.svg','dist/favicon.svg');
await import('node:fs/promises').then(fs=>fs.writeFile('dist/.nojekyll',''));
console.log('Static GitHub Pages build ready in dist/');
