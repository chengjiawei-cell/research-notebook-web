import { bilingualParagraphs,cachedBilingualTranslation } from './reading-utils.js';
import { icon } from './icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export class BilingualPage {
  constructor({container,storage,translator,onExcerpt,onRetry}) {
    Object.assign(this,{container,storage,translator,onExcerpt,onRetry});this.sequence=0;this.key='';this.state='idle';
    container.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.hasAttribute('data-bilingual-retry'))return this.onRetry();if(button.dataset.bilingualExcerpt!==undefined){const index=Number(button.dataset.bilingualExcerpt),row=this.rows[index];if(row?.translated)this.onExcerpt(row.source,row.translated,this.page);}});
  }
  async engine(preference){
    if(preference==='native'||preference==='online')return preference;
    if(this.translator.instances?.has('en|zh'))return 'native';
    if(this.translator.native&&globalThis.navigator?.userActivation?.isActive){try{if(await this.translator.native.availability({sourceLanguage:'en',targetLanguage:'zh'})==='available')return 'native';}catch{}}
    return 'online';
  }
  start(content,{page,documentId,preference='auto',force=false}={}) {
    const paragraphs=bilingualParagraphs(content),key=JSON.stringify([documentId,page,preference,paragraphs]);
    if(!force&&this.key===key&&['running','complete','error'].includes(this.state))return this.work;
    this.cancel();const sequence=++this.sequence;this.controller=new AbortController();const signal=this.controller.signal;
    this.key=key;this.state='running';this.page=page;this.cacheFailed=false;this.rows=paragraphs.map(source=>({source,translated:''}));
    this.container.setAttribute('aria-busy','true');
    this.container.innerHTML=`<div class="bilingual-intro"><div><strong>第 ${page} 页 · 中英对照</strong><p>按正文重排显示，图表与公式可切换到原版 PDF。</p></div><span id="bilingual-provider">正在准备…</span></div><p id="bilingual-status" class="bilingual-status" role="status">${paragraphs.length?'正在读取译文缓存…':'此页未提取到文字，扫描页需先 OCR；可以切换原版 PDF 查看。'}</p>${paragraphs.length?'<div class="bilingual-column-head"><span>ENGLISH · 英文原文</span><span>中文译文</span></div>':''}<div class="bilingual-rows">${this.rows.map((row,index)=>`<article class="bilingual-row"><div class="bilingual-source"><span class="bilingual-paragraph-label">原文 ${index+1}</span><p>${esc(row.source)}</p></div><div class="bilingual-target"><span class="bilingual-paragraph-label">译文 ${index+1}</span><p id="bilingual-text-${index}" class="bilingual-pending">等待翻译…</p><button class="text-link" data-bilingual-excerpt="${index}" disabled>${icon('note')}双语摘录到笔记</button></div></article>`).join('')}</div><div class="bilingual-recovery" hidden><button class="btn small-btn" data-bilingual-retry>${icon('refresh')}继续 / 重试未完成段落</button><p>在线服务有用量限制。可在上方切换本机翻译；已生成的译文会保留。</p></div>`;
    const status=this.container.querySelector('#bilingual-status'),provider=this.container.querySelector('#bilingual-provider');
    const active=()=>sequence===this.sequence&&!signal.aborted;let done=0,cacheHits=0;
    this.work=(async()=>{
      if(!paragraphs.length){this.state='complete';this.container.setAttribute('aria-busy','false');provider.textContent='没有可选文字';return;}
      try{
        let engine=await this.engine(preference);if(!active())return;provider.textContent=engine==='native'?'浏览器本机翻译':'MyMemory 在线翻译';
        for(let index=0;index<this.rows.length;index++){
          signal.throwIfAborted();const row=this.rows[index];
          status.textContent=`正在翻译 ${index+1} / ${this.rows.length} 段 · 已完成 ${done} 段`;
          const options={engine,signal,onProgress:message=>{if(active())status.textContent=`第 ${index+1} / ${this.rows.length} 段 · ${message}`;}};
          let result;
          try{result=await cachedBilingualTranslation(this.storage,this.translator,row.source,options);}
          catch(error){if(preference!=='auto'||engine!=='native')throw error;signal.throwIfAborted();engine='online';provider.textContent='MyMemory（本机暂不可用）';result=await cachedBilingualTranslation(this.storage,this.translator,row.source,{...options,engine});}
          if(!active())return;row.translated=result.text;done++;if(result.cached)cacheHits++;
          const target=this.container.querySelector(`#bilingual-text-${index}`);target.textContent=result.text;target.classList.remove('bilingual-pending');this.container.querySelector(`[data-bilingual-excerpt="${index}"]`).disabled=false;
          if(!result.stored)this.cacheFailed=true;
        }
        if(!active())return;this.state='complete';status.textContent=cacheHits===done?`已直接显示缓存译文 · ${done} 段`:`本页对照已生成 · ${done} 段${this.cacheFailed?'（部分译文未能缓存）':' · 已缓存在本设备'}`;
      }catch(error){
        if(!active())return;this.state='error';status.textContent=`${done?'已保留 '+done+' 段译文。':''}${error.message}`;this.container.querySelector('.bilingual-recovery').hidden=false;
        for(let index=0;index<this.rows.length;index++)if(!this.rows[index].translated)this.container.querySelector(`#bilingual-text-${index}`).textContent='尚未生成译文，可重试或切换翻译方式。';
      }finally{if(active())this.container.setAttribute('aria-busy','false');}
    })();return this.work;
  }
  cancel(){this.controller?.abort();this.sequence++;if(this.state==='running')this.state='paused';this.container.setAttribute('aria-busy','false');}
  clear(){this.cancel();this.key='';this.state='idle';this.container.replaceChildren();}
}
