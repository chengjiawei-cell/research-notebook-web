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
