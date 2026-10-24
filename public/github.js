import { validate, collections } from './schema.js';

export function emptyWorkspace() {
  return { version:1, profile:{ name:'', university:'', major:'', goal:'让每一次探索，都留下清晰的足迹。' }, ...Object.fromEntries(collections.map(key=>[key,[]])) };
}
export function base64(bytes) {
  let binary='';
  for(let i=0;i<bytes.length;i+=16384) binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}
export function decode64(value) { return Uint8Array.from(atob(value.replace(/\s/g,'')), c=>c.charCodeAt(0)); }
const problem=(message,status=400)=>Object.assign(new Error(message),{status});
const encodePath=value=>value.split('/').map(encodeURIComponent).join('/');

// The token stays in this instance's memory. It is never written to browser storage.
export class PrivateGitHub {
  constructor(repository,token,fetcher=globalThis.fetch.bind(globalThis)) {
    if(!/^[\w.-]+\/[\w.-]+$/.test(repository)||repository.split('/').some(x=>x==='.'||x==='..'))throw problem('请输入 owner/repository 格式的仓库名称。');
    if(!token?.trim())throw problem('请填写用于访问此私有仓库的 GitHub 访问令牌。');
    this.repository=repository;this.token=token.trim();this.fetcher=fetcher;this.branch='';this.head='';
  }
  async call(route,method='GET',body,raw=false) {
    let response;
    try { response=await this.fetcher(`https://api.github.com/repos/${this.repository}${route}`,{
      method, headers:{Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',Authorization:`Bearer ${this.token}`,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)
    }); } catch { throw problem('无法连接 GitHub。请检查网络后重试；此次修改尚未保存。',503); }
    if(!response.ok) {
      const messages={401:'GitHub 授权已失效，请重新连接。',403:'GitHub 拒绝访问。请检查令牌的 Contents 读写权限或 API 配额。',404:'找不到仓库或记录，请确认仓库名称和令牌访问范围。',409:'仓库内容发生冲突，请重新连接并下载最新记录。',422:'仓库已被其他设备更新，或不允许写入。请重新连接后重试。'};
      throw problem(messages[response.status]||`GitHub 请求失败（${response.status}）。`,response.status);
    }
    return raw?response.blob():response.status===204?null:response.json();
  }
  async snapshot() {
    const repository=await this.call('');
    if(!repository.private)throw problem('科研资料只允许连接私有仓库，请选择 private 仓库。');
    this.branch=repository.default_branch;
    let ref;
    try { ref=await this.call(`/git/ref/heads/${encodePath(this.branch)}`); }
    catch(e) { if([404,409].includes(e.status))throw problem('这个仓库还没有首次提交，请先用 GitHub Desktop 推送项目。');throw e; }
    const head=ref.object.sha;
    let data;
    try { const content=await this.call(`/contents/data/workspace.json?ref=${head}`);data=validate(JSON.parse(new TextDecoder().decode(decode64(content.content)))); }
    catch(e) { if(e.status===404)data=emptyWorkspace();else throw e; }
    this.head=head;return {data,revision:head};
  }
  async save(data,expected,files=new Map()) {
    validate(data);
    const ref=await this.call(`/git/ref/heads/${encodePath(this.branch)}`);
    if(ref.object.sha!==expected)throw problem('其他设备已更新仓库。请导出当前记录，再重新连接获取最新版本。',409);
    const parent=await this.call(`/git/commits/${expected}`);
    const document=await this.call('/git/blobs','POST',{content:JSON.stringify(data,null,2)+'\n',encoding:'utf-8'});
    const tree=[{path:'data/workspace.json',mode:'100644',type:'blob',sha:document.sha}];
    for(const [path,bytes] of files) {
      if(!/^materials\/[\w-]+\/[\w.-]+$/.test(path)||path.includes('..'))throw problem('资料路径无效。');
      if(bytes===null)tree.push({path,mode:'100644',type:'blob',sha:null});
      else {
        const blob=await this.call('/git/blobs','POST',{content:base64(bytes),encoding:'base64'});
        tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
      }
    }
    const nextTree=await this.call('/git/trees','POST',{base_tree:parent.tree.sha,tree});
    const commit=await this.call('/git/commits','POST',{message:`Update research notebook · ${new Date().toISOString()}`,tree:nextTree.sha,parents:[expected]});
    // Never force-push: a concurrent writer causes the ref update to fail.
    await this.call(`/git/refs/heads/${encodePath(this.branch)}`,'PATCH',{sha:commit.sha,force:false});
    this.head=commit.sha;return {data,revision:commit.sha};
  }
  async file(path) {
    if(!/^materials\/[\w-]+\/[\w.-]+$/.test(path)||path.includes('..'))throw problem('资料路径无效。');
    return this.call(`/contents/${encodePath(path)}?ref=${this.head}`,'GET',undefined,true);
  }
  disconnect(){this.token='';}
}
