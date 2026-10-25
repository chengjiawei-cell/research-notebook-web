import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=path.resolve(root,'dist');
if(path.dirname(target)!==root||path.basename(target)!=='dist')throw new Error('Invalid build directory');
try { if((await fs.lstat(target)).isSymbolicLink())throw new Error('The build directory cannot be a symbolic link'); } catch(e) { if(e.code!=='ENOENT')throw e; }
// Only remove the verified project-local build output.
await fs.rm(target,{recursive:true,force:true});await fs.mkdir(target);
export const assets=['index.html','styles.css','reader.css','app.js','reader.js','bilingual.js','reading-utils.js','translation.js','domain.js','icons.js','schema.js','storage.js','github.js','favicon.svg','.nojekyll'];
const contents=new Map();const digest=createHash('sha256');
for(const name of assets){const bytes=await fs.readFile(path.join(root,'public',name));contents.set(name,bytes);digest.update(name).update(bytes);}
const version=digest.digest('hex').slice(0,12);
for(const name of assets){
  let bytes=contents.get(name);
  if(name.endsWith('.js'))bytes=Buffer.from(bytes.toString('utf8').replace(/((?:from\s*|import\s*\()\s*['"])(\.\/[a-zA-Z0-9_.-]+\.js)(['"])/g,(_,prefix,module,quote)=>`${prefix}${module}?v=${version}${quote}`));
  if(name==='index.html')bytes=Buffer.from(bytes.toString('utf8').replace(/((?:src|href)="\.\/[^"\s]+\.(?:js|css))"/g,`$1?v=${version}"`).replace('<meta name="research-runtime" content="static">',`<meta name="research-runtime" content="static">\n  <meta name="research-version" content="${version}">`));
  await fs.writeFile(path.join(target,name),bytes);
}
await fs.cp(path.join(root,'public','vendor','pdfjs'),path.join(target,'vendor','pdfjs'),{recursive:true});
console.log(`GitHub Pages package ready: ${target} (${assets.length} application assets plus PDF.js, no research data)`);
