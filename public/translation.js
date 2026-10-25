import { splitTranslation } from './reading-utils.js';
const languages=new Set(['en','zh-CN','ja','de','fr','es','ko']);
function decodeEntities(value) {
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
    if(entity[0]!=='#')return named[entity.toLowerCase()];
    const value=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    return value>0&&value<=0x10ffff?String.fromCodePoint(value):'';
  });
}
export class TranslationService {
  constructor({fetcher=globalThis.fetch.bind(globalThis),native=globalThis.Translator}={}){this.fetcher=fetcher;this.native=native;this.instances=new Map();}
  async translate(text,{from='en',to='zh-CN',engine='online',signal,onProgress=()=>{}}={}) {
    const source=text.trim();
    if(!source)throw new Error('请先选择论文文字，或粘贴需要翻译的段落。');
    if(source.length>3000)throw new Error('请每次翻译不超过 3000 字符，建议选择一到两段。');
    if(!languages.has(from)||!languages.has(to))throw new Error('不支持的翻译语言。');
    if(from===to)throw new Error('请选择不同的源语言和目标语言。');
    signal?.throwIfAborted();
    if(engine==='native') {
      if(!this.native)throw new Error('此浏览器暂不支持本机翻译，请选择 MyMemory 在线翻译。');
      const sourceLanguage=from==='zh-CN'?'zh':from,targetLanguage=to==='zh-CN'?'zh':to;
      const key=`${sourceLanguage}|${targetLanguage}`;
      if(!this.instances.has(key)) {
        const availability=await this.native.availability({sourceLanguage,targetLanguage});
        if(availability==='unavailable')throw new Error('浏览器不支持这个语言组合，请选择在线翻译或更换语言。');
        onProgress('正在准备本机翻译模型，首次使用可能需要下载…');
        const instance=await this.native.create({sourceLanguage,targetLanguage,monitor(m){m.addEventListener('downloadprogress',e=>onProgress(`正在下载本机模型 ${Math.round(e.loaded*100)}%…`));}});
        this.instances.set(key,instance);
      }
      onProgress('正在本机翻译…');
      const result=await this.instances.get(key).translate(source);signal?.throwIfAborted();return result;
    }
    if(engine!=='online')throw new Error('无效的翻译方式。');
    const chunks=splitTranslation(source);const output=[];
    for(let i=0;i<chunks.length;i++) {
      signal?.throwIfAborted();onProgress(`正在翻译 ${i+1} / ${chunks.length}…`);
      const url=new URL('https://api.mymemory.translated.net/get');url.searchParams.set('q',chunks[i]);url.searchParams.set('langpair',`${from}|${to}`);url.searchParams.set('mt','1');
      let response;
      try{response=await this.fetcher(url.href,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),credentials:'omit',referrerPolicy:'no-referrer'});}catch(e){if(signal?.aborted)throw e;throw new Error('暂时无法连接在线翻译服务，请检查网络或选择本机翻译。');}
      if(!response.ok)throw new Error(response.status===429?'在线翻译服务已达到额度，请稍后再试或选择本机翻译。':`翻译服务请求失败（${response.status}），此次译文没有保存。`);
      const data=await response.json();
      if(data.quotaFinished||Number(data.responseStatus)===429)throw new Error('在线翻译额度已用完，请稍后再试或选择本机翻译。');
      if(Number(data.responseStatus)!==200||typeof data.responseData?.translatedText!=='string')throw new Error('在线翻译未返回有效译文，请稍后再试。');
      output.push(decodeEntities(data.responseData.translatedText));
    }
    return output.join('\n');
  }
  destroy(){for(const instance of this.instances.values())instance.destroy?.();this.instances.clear();}
}
