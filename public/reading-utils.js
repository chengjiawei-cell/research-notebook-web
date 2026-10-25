export function pdfCandidate(paper) {
  const value=(paper.pdfUrl||paper.url||'').trim();
  if(!value)return '';
  let url;try{url=new URL(value);}catch{return '';}
  if(url.protocol!=='https:'||url.username||url.password)return '';
  if(/(^|\.)arxiv\.org$/i.test(url.hostname)) {
    const match=url.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/);
    if(match)return `https://arxiv.org/pdf/${match[1]}`;
  }
  return paper.pdfUrl||/\.pdf$/i.test(url.pathname)?url.href:'';
}
export function splitTranslation(text,maxBytes=450) {
  if(!Number.isInteger(maxBytes)||maxBytes<4)throw new Error('无效的分段大小。');
  const points=Array.from(text.trim());const encoder=new TextEncoder();const result=[];
  while(points.length) {
    let bytes=0,end=0,lastBreak=0;
    while(end<points.length) {
      const next=encoder.encode(points[end]).length;if(bytes+next>maxBytes)break;
      bytes+=next;end++;
      if(/[\s.!?。！？；;]/u.test(points[end-1]))lastBreak=end;
    }
    if(end<points.length&&lastBreak>Math.floor(end*.55))end=lastBreak;
    result.push(points.splice(0,end).join(''));
  }
  return result;
}
export function readingDraftKey(paperId,demo=false) {return `paper-draft:${demo?'demo':'real'}:${paperId}`;}
export function readingPdfKey(paperId,demo=false) {return `paper-pdf:${demo?'demo':'real'}:${paperId}`;}
export function formatExcerpt(text,page,translation='') {
  const quote=text.trim().split('\n').map(line=>`> ${line}`).join('\n');
  return `### 第 ${page} 页摘录\n\n${quote}${translation?`\n\n译文：${translation.trim()}`:''}\n\n`;
}
export function notesMarkdown(paper,notes,page=1) {
  return `# ${paper.title}\n\n${[paper.author,paper.year].filter(Boolean).join(' · ')}\n${paper.url?`原文：${paper.url}\n`:''}\n阅读位置：第 ${page} 页\n\n${notes}\n`;
}

export function bilingualParagraphs(content,maxLength=1400) {
  const lines=[];let current=null;
  const flush=()=>{if(current?.text.trim())lines.push({...current,text:current.text.trim()});current=null;};
  for(const item of content?.items||[]) {
    if(typeof item.str!=='string'||!item.str.trim()){if(item.hasEOL)flush();continue;}
    const x=item.transform?.[4]??0,y=item.transform?.[5]??0,height=Math.abs(item.height||item.transform?.[3]||12);
    if(current&&(Math.abs(y-current.y)>Math.max(2,height*.4)||x-current.right>Math.max(60,height*4)))flush();
    if(!current)current={text:'',x,y,height,right:x};
    current.text+=(current.text&&!/\s$/.test(current.text)?' ':'')+item.str;current.right=x+(item.width||0);current.height=Math.max(current.height,height);
    if(item.hasEOL)flush();
  }
  flush();const paragraphs=[];let text='',previous=null;
  const finish=()=>{if(text.trim())paragraphs.push(text.trim());text='';};
  for(const line of lines) {
    const gap=previous?previous.y-line.y:0;
    if(previous&&(gap< -previous.height||gap>Math.max(previous.height,line.height)*1.65||line.height>previous.height*1.25||previous.height>line.height*1.25))finish();
    const piece=line.text.replace(/\s+/g,' ');
    if(text.length+piece.length+1>maxLength)finish();
    if(piece.length>maxLength){finish();for(const chunk of splitTranslation(piece,maxLength))paragraphs.push(chunk.trim());}
    else text+=text?(text.endsWith('-')?piece:' '+piece):piece;
    previous=line;
  }
  finish();return paragraphs;
}

export async function bilingualCacheKey(source,engine) {
  const bytes=new TextEncoder().encode(`v1|en|zh-CN|${engine}|${source}`);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return 'bilingual:v1:'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function cachedBilingualTranslation(storage,translator,source,{engine='online',signal,onProgress}={}) {
  signal?.throwIfAborted();const key=await bilingualCacheKey(source,engine);const cached=await storage.get(key);signal?.throwIfAborted();
  if(cached?.source===source&&typeof cached.translated==='string'&&cached.translated.trim())return {text:cached.translated,cached:true,stored:true};
  const translated=await translator.translate(source,{from:'en',to:'zh-CN',engine,signal,onProgress});signal?.throwIfAborted();
  if(typeof translated!=='string'||!translated.trim())throw new Error('翻译没有返回有效内容，请重试。');
  let stored=true;try{await storage.write([[key,{source,translated,engine,from:'en',to:'zh-CN',createdAt:Date.now()}]]);}catch{stored=false;}
  return {text:translated,cached:false,stored};
}
