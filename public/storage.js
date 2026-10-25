import { emptyWorkspace, PrivateGitHub, decode64 } from './github.js';
import { validate } from './schema.js';

const conflict=()=>new Error('记录已在其他窗口更新。请刷新页面后重新操作。');
export class NotebookStorage {
  constructor({online=document.querySelector('meta[name="research-runtime"]')?.content!=='local'}={}) {
    this.online=online;this.client=null;this.database=null;this.repo='';
  }
  get connected(){return Boolean(this.client);}
  label(){return !this.online?'本地文件已保存':this.connected?'已同步到私有 GitHub 仓库':'已保存到此浏览器 · 未连接 GitHub';}
  async db(){
    if(this.database)return this.database;
    this.database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('research-notebook-online-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('records');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('浏览器无法保存记录，请允许此网站使用本地存储。'));
    });return this.database;
  }
  async get(key){const db=await this.db();return new Promise((resolve,reject)=>{const req=db.transaction('records').objectStore('records').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async write(entries){
    const db=await this.db();return new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readwrite');const store=tx.objectStore('records');
      for(const [key,value] of entries)value===undefined?store.delete(key):store.put(value,key);
      tx.oncomplete=resolve;tx.onabort=()=>reject(new Error('浏览器空间不足或保存被中断。请导出备份后重试。'));tx.onerror=()=>{};
    });
  }
  async locked(fn){return navigator.locks?navigator.locks.request('research-notebook-write',fn):fn();}
  async current(){
    let current=await this.get('workspace');
    if(!current){current={data:emptyWorkspace(),revision:crypto.randomUUID()};await this.write([['workspace',current]]);}
    return current;
  }
  async connect(repository,token,direction='download') {
    return this.locked(async()=>{
      const client=new PrivateGitHub(repository,token);
      let next=await client.snapshot();
      const current=await this.current();
      if(direction==='upload') {
        const files=new Map();
        for(const file of current.data.files){const blob=await this.get(`file:${file.path}`);if(!blob)throw new Error(`本设备缺少附件“${file.name}”，请先下载完整资料再上传工作区。`);files.set(file.path,new Uint8Array(await blob.arrayBuffer()));}
        next=await client.save(current.data,next.revision,files);
      }
      await this.write([['backup:before-connect',current],['backup:last-save',current],['workspace',next],['last-repository',repository]]);
      this.client?.disconnect();this.client=client;this.repo=repository;
      return next;
    });
  }
  async disconnect(){
    return this.locked(async()=>{const current=await this.current();current.revision=crypto.randomUUID();await this.write([['workspace',current]]);this.client?.disconnect();this.client=null;return current;});
  }
  async save(next,expected,fileChanges=new Map()){
    return this.locked(async()=>{
      validate(next);
      const current=await this.current();if(current.revision!==expected)throw conflict();
      for(const file of next.files) {
        const exists=current.data.files.some(old=>old.path===file.path);
        if(!exists&&!fileChanges.has(file.path)){
          const cached=await this.get(`file:${file.path}`)||await this.get(`trash:${file.path}`);
          if(!cached)throw new Error(`缺少实际附件“${file.name}”。记录备份不包含文件本体，请先上传附件。`);
          fileChanges.set(file.path,new Uint8Array(await cached.arrayBuffer()));
        }
      }
      let result={data:next,revision:crypto.randomUUID()};
      if(this.client)result=await this.client.save(next,expected,fileChanges);
      const entries=[['backup:last-save',current],['workspace',result]];
      for(const [path,bytes] of fileChanges) {
        if(bytes===null){const old=await this.get(`file:${path}`);if(old)entries.push([`trash:${path}`,old]);entries.push([`file:${path}`,undefined]);}
        else entries.push([`file:${path}`,new Blob([bytes])]);
      }
      try {await this.write(entries);}catch(e){if(this.client)throw new Error('GitHub 已保存成功，但此设备缓存写入失败。请重新连接下载最新记录，避免重复提交。');throw e;}
      return result;
    });
  }
  async request(route,options={}) {
    if(!this.online){const response=await fetch(route,{...options,headers:{'Content-Type':'application/json',...options.headers}});const result=await response.json();if(!response.ok)throw new Error(result.error||'操作失败，请重试。');return result;}
    const method=options.method||'GET';
    if(route==='/api/workspace'&&method==='GET')return this.locked(()=>this.current());
    if(route==='/api/git'){if(!this.repo)this.repo=await this.get('last-repository')||'';return {changed:0,remote:this.repo?`https://github.com/${this.repo}`:'',online:true,connected:this.connected};}
    if(route==='/api/workspace'&&method==='PUT')return this.save(JSON.parse(options.body),options.headers?.['If-Match']);
    if(route==='/api/files'&&method==='POST'){
      const input=JSON.parse(options.body);const current=await this.current();const data=structuredClone(current.data);
      if(!data.groups.some(g=>g.id===input.groupId))throw new Error('请先选择所属课题组。');
      const bytes=decode64(input.base64);if(bytes.length>20*1024*1024)throw new Error('单个文件不能超过 20 MB。');
      const id=crypto.randomUUID();const safe=input.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100).replace(/\.{2,}/g,'_')||'file';const path=`materials/${input.groupId}/${id}_${safe}`;
      data.files.push({id,name:input.name,path,size:bytes.length,groupId:input.groupId,category:input.category||'其他',date:new Date().toISOString().slice(0,10)});
      return this.save(data,options.headers?.['If-Match'],new Map([[path,bytes]]));
    }
    if(route.startsWith('/api/files/')&&method==='DELETE'){
      const current=await this.current();const data=structuredClone(current.data);const id=decodeURIComponent(route.slice('/api/files/'.length));const file=data.files.find(f=>f.id===id);if(!file)throw new Error('资料不存在。');
      data.files=data.files.filter(f=>f.id!==id);for(const paper of data.papers)if(paper.pdfFileId===id)paper.pdfFileId='';return this.save(data,options.headers?.['If-Match'],new Map([[file.path,null]]));
    }
    throw new Error('不支持的操作。');
  }
  async download(file){
    if(!this.online){const response=await fetch(`/${file.path}`);if(!response.ok)throw new Error('下载失败，资料不存在。');return response.blob();}
    let blob=await this.get(`file:${file.path}`);
    if(!blob&&this.client){blob=await this.client.file(file.path);await this.write([[`file:${file.path}`,blob]]);}
    if(!blob)throw new Error('附件尚未缓存在此设备。请连接私有 GitHub 仓库后下载。');
    return blob;
  }
  async backup(){return this.get('backup:last-save');}
}
