import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(root,'dist');
if(path.dirname(target)!==root||path.basename(target)!=='dist')throw new Error('Invalid build directory');
try { if((await fs.lstat(target)).isSymbolicLink())throw new Error('The build directory cannot be a symbolic link'); } catch(e) { if(e.code!=='ENOENT')throw e; }
// Only remove the verified project-local build output.
await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target);
export const assets=['index.html','styles.css','reader.css','app.js','reader.js','reading-utils.js','translation.js','domain.js','icons.js','schema.js','storage.js','github.js','favicon.svg','.nojekyll'];
for(const name of assets)await fs.copyFile(path.join(root,'public',name),path.join(target,name));
await fs.cp(path.join(root,'public','vendor','pdfjs'),path.join(target,'vendor','pdfjs'),{recursive:true});
console.log(`GitHub Pages package ready: ${target} (${assets.length} application assets plus PDF.js, no research data)`);
