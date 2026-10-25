import { icon } from './icons.js';
import { TranslationService } from './translation.js';
import { BilingualPage } from './bilingual.js';
import { pdfCandidate, readingDraftKey, readingPdfKey, formatExcerpt, notesMarkdown } from './reading-utils.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MAX_PDF=20*1024*1024;
const languageOptions=selected=>[['en','英语'],['zh-CN','简体中文'],['ja','日语'],['de','德语'],['fr','法语'],['es','西班牙语'],['ko','韩语']].map(([value,label])=>`<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join('');
const button=(label,action,glyph,classes='')=>`<button type="button" class="btn ${classes}" data-reader="${action}">${icon(glyph)}${label}</button>`;

export class PaperReader {
  constructor(context){
    this.context=context;this.translator=new TranslationService();this.session=0;this.renderSequence=0;this.sourceSequence=0;
    this.dialog=document.createElement('dialog');this.dialog.className='paper-reader';this.dialog.id='paper-reader';this.dialog.setAttribute('aria-labelledby','reader-title');document.body.append(this.dialog);
    this.dialog.addEventListener('click',e=>{const target=e.target.closest('[data-reader]');if(target)this.action(target.dataset.reader).catch(error=>this.error(error.message));});
    this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.close().catch(error=>this.error(error.message));});
    this.dialog.addEventListener('input',e=>{if(e.target.id==='reader-notes')this.scheduleDraft();if(e.target.id==='reader-translation-source')this.$('#reader-insert-translation').disabled=true;});
    this.dialog.addEventListener('change',e=>this.change(e).catch(error=>this.error(error.message)));
    this.dialog.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();this.save().catch(error=>this.error(error.message));}
      if(e.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();this.tab(e.target.dataset.reader==='tab-notes'?'translation':'notes');this.$(`[data-reader="tab-${this.activeTab}"]`).focus();}
    });
    window.addEventListener('beforeunload',e=>{if(this.dialog.open&&(this.busy||this.$('#reader-notes')?.value!==this.lastDraft)){this.saveDraft().catch(()=>{});e.preventDefault();e.returnValue='';}});
    document.addEventListener('selectionchange',()=>{
      if(!this.dialog.open)return;const selection=window.getSelection(),layer=this.$(this.viewMode==='bilingual'?'#reader-bilingual':'.textLayer');
      if(selection?.rangeCount&&layer?.contains(selection.anchorNode)&&layer.contains(selection.focusNode)){
        this.selection=selection.toString().trim();this.$('#reader-selection').textContent=this.selection?`已选 ${this.selection.length} 字符 · 第 ${this.pageNumber} 页`:'在论文中选择文字，即可摘录或翻译';
        for(const name of ['quote','translate-selection'])this.$(`[data-reader="${name}"]`).disabled=!this.selection;
      }
    });
  }
  $(selector){return this.dialog.querySelector(selector);}
  paper(){return this.context.getData().papers.find(p=>p.id===this.paperId);}
  files(){return this.context.getData().files.filter(f=>f.groupId===this.paper()?.groupId&&/\.pdf$/i.test(f.name));}
  async open(id){
    if(this.dialog.open){await this.close();if(this.dialog.open)return;}
    this.paperId=id;const paper=this.paper();if(!paper)throw new Error('文献不存在，请刷新列表。');
    const opening=++this.session;this.demo=this.context.isDemo();this.key=readingDraftKey(id,this.demo);this.pdfKey=readingPdfKey(id,this.demo);
    const draft=await this.context.storage.get(this.key);
    const preferences=await this.context.storage.get('reader-bilingual-options');this.bilingualEngine=['auto','native','online'].includes(preferences?.engine)?preferences.engine:'auto';this.viewMode='bilingual';this.currentPageContent=null;this.bilingualPageNumber=0;
    if(opening!==this.session)return;
    this.baseNotes=paper.readingNotes||'';
    this.notes=draft?.dirty&&typeof draft.notes==='string'?draft.notes:this.baseNotes;this.lastDraft=this.notes;
    this.pageNumber=Math.max(1,Number(draft?.page||paper.readingPage||1));
    this.selectedFileId=draft?.pdfFileId??paper.pdfFileId??'';
    this.sourceUrl=draft?.sourceUrl??paper.pdfUrl??'';
    this.zoom=1;this.selection='';this.activeTab='notes';this.localBlob=null;this.localName='';this.pageText='';this.busy=false;this.draftFailed=false;
    this.dialog.innerHTML=this.html(paper,draft);
    this.bilingual=new BilingualPage({container:this.$('#reader-bilingual'),storage:this.context.storage,translator:this.translator,onExcerpt:(source,translated,page)=>{try{this.append(formatExcerpt(source,page,translated));}catch(error){this.error(error.message);}},onRetry:()=>this.applyView(true)});
    this.$('#reader-bilingual-engine').value=this.bilingualEngine;
    this.dialog.showModal();this.dialog.scrollTop=0;this.tab('notes');
    this.resizeObserver?.disconnect();let lastWidth=0;
    this.resizeObserver=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(this.pdf&&Math.abs(width-lastWidth)>4){lastWidth=width;clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>this.renderPage(),160);}});
    this.resizeObserver.observe(this.$('#reader-pdf-scroll'));
    const session=this.session,initialSource=this.sourceSequence;
    try{
      const cached=await this.context.storage.get(this.pdfKey);if(session!==this.session||initialSource!==this.sourceSequence)return;
      const file=this.files().find(f=>f.id===this.selectedFileId);
      if(file){const blob=cached?.fileId===file.id?cached.blob:await this.context.storage.download(file);if(session===this.session&&initialSource===this.sourceSequence)await this.loadPdf(blob,file.name,{kind:'library',fileId:file.id});}
      else if(cached?.blob&&(cached.kind!=='url'||cached.sourceUrl===(this.sourceUrl||pdfCandidate(paper))))await this.loadPdf(cached.blob,cached.name,{kind:cached.kind,sourceUrl:cached.sourceUrl||'',fileId:cached.fileId||''});
      else{const url=this.sourceUrl||pdfCandidate(paper);if(url){this.$('#reader-pdf-url').value=url;await this.loadUrl(url);}}
    }catch(error){if(session===this.session)this.pdfError(error.message);}
  }
  html(paper,draft){
    const conflict=draft?.dirty&&draft.baseNotes!==undefined&&draft.baseNotes!==this.baseNotes;
    return `<header class="reader-header"><div class="reader-heading"><span class="eyebrow">PAPER / READING ROOM</span><h2 id="reader-title">${esc(paper.title)}</h2><p>${esc([paper.author,paper.year].filter(Boolean).join(' · ')||'文献阅读工作台')}</p></div><div class="button-row">${paper.url?`<a class="btn small-btn" href="${esc(paper.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}原文</a>`:''}${button('返回文献','close','close','small-btn')}</div></header><div class="reader-body"><section class="reader-document" aria-label="论文 PDF 阅读区"><div class="reader-source-bar"><button class="btn small-btn reader-file-label" data-reader="choose-file">${icon('folder')}打开本机 PDF</button><input id="reader-file" type="file" accept="application/pdf,.pdf" hidden><label class="reader-library-label"><span class="visually-hidden">课题组 PDF 资料</span><select id="reader-library" aria-label="从课题组资料库打开 PDF">${this.libraryOptions()}</select></label><button class="btn small-btn" data-reader="upload" id="reader-upload" disabled>${icon('upload')}保存 PDF 到资料库</button></div><div class="reader-url-bar"><label for="reader-pdf-url" class="visually-hidden">可直接下载的 HTTPS PDF 链接</label><input id="reader-pdf-url" type="url" placeholder="或粘贴可直接下载的 HTTPS PDF 链接" value="${esc(this.sourceUrl||pdfCandidate(paper))}">${button('打开链接','open-url','external','small-btn')}</div><div class="reader-page-toolbar"><div class="button-row"><button class="icon-btn" data-reader="previous" aria-label="上一页" disabled>${icon('chevron','reader-back-icon')}</button><label>第 <input id="reader-page" type="number" min="1" value="${this.pageNumber}" aria-label="阅读页码" disabled> / <span id="reader-page-count">—</span> 页</label><button class="icon-btn" data-reader="next" aria-label="下一页" disabled>${icon('chevron')}</button></div><select id="reader-zoom" aria-label="阅读缩放"><option value="1">适宽</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select><span id="reader-pdf-name" class="reader-pdf-name">尚未打开 PDF</span></div><div class="reader-view-bar"><div class="reader-view-buttons" role="group" aria-label="阅读显示方式"><button class="btn small-btn" data-reader="view-bilingual" aria-pressed="true">${icon('book')}中英对照</button><button class="btn small-btn" data-reader="view-pdf" aria-pressed="false">${icon('paper')}原版 PDF</button></div><label><span class="visually-hidden">自动对照翻译方式</span><select id="reader-bilingual-engine" aria-label="自动对照翻译方式"><option value="auto">自动：本机优先 / 在线备用</option><option value="online">MyMemory 在线翻译</option><option value="native">浏览器本机翻译</option></select></label><button class="icon-btn" id="reader-bilingual-retry" data-reader="retry-bilingual" aria-label="重试未完成的对照翻译" disabled>${icon('refresh')}</button><p>打开后自动翻译当前页；在线模式仅发送本页文字，不发送笔记或整个 PDF 文件。</p></div><div id="reader-pdf-scroll" class="reader-pdf-scroll"><div id="reader-pdf-message" class="reader-pdf-message">${icon('paper')}<h3>让论文与思考，并排展开。</h3><p>打开本机 PDF，或选择课题组已有的 PDF，自动显示当前页的中英对照；右侧可同时写笔记。</p><p class="small">论文网页不能直接读取时，请先在原文网站下载 PDF，再在这里打开。扫描版 PDF 可能没有可选文字，可在翻译框手动粘贴。</p></div><div id="reader-page-surface" class="reader-page-surface" hidden><canvas id="reader-canvas" aria-hidden="true"></canvas><div class="textLayer" aria-label="可选择的论文文字"></div></div><section id="reader-bilingual" class="reader-bilingual" aria-label="英文原文与中文译文逐段对照" hidden></section></div><div class="reader-selection-bar"><span id="reader-selection">在论文中选择文字，即可摘录或翻译</span><div class="button-row"><button class="btn small-btn" data-reader="quote" disabled>${icon('note')}摘录到笔记</button><button class="btn small-btn" data-reader="translate-selection" disabled>${icon('refresh')}翻译所选</button></div></div></section><aside class="reader-sidebar" aria-label="阅读笔记和翻译"><div class="reader-tabs" role="tablist" aria-label="阅读辅助工具"><button id="reader-tab-notes" role="tab" aria-controls="reader-notes-panel" aria-selected="true" data-reader="tab-notes">${icon('note')}阅读笔记</button><button id="reader-tab-translation" role="tab" aria-controls="reader-translation-panel" aria-selected="false" data-reader="tab-translation">${icon('refresh')}段落翻译</button></div><section id="reader-notes-panel" class="reader-tool-panel" role="tabpanel" aria-labelledby="reader-tab-notes"><div class="reader-note-intro"><strong>把读到的，变成自己的理解。</strong><p>草稿会自动保存到本设备。点击下方保存按钮，将笔记写入这篇文献；已连接私有仓库时也会同步。</p></div>${conflict?'<p class="reader-warning">文献已有其他版本，你正在查看本机未同步草稿。保存前请核对笔记内容。</p>':''}<label for="reader-notes" class="visually-hidden">这篇文献的阅读笔记</label><textarea id="reader-notes" maxlength="100000" placeholder="研究问题 / 核心方法 / 关键结论 / 我的思考…&#10;&#10;支持纯文本和 Markdown，选中原文后可直接摘录。">${esc(this.notes)}</textarea><div class="reader-note-status"><span id="reader-draft-status" role="status">${draft?.dirty?'已恢复本机草稿':this.notes?'已载入文献笔记':'准备记录新的思考'}</span><span id="reader-note-count">${this.notes.length} 字符</span></div><div class="reader-note-tools">${button('笔记模板','template','plus','small-btn')}${button('导出笔记','export','download','small-btn')}</div><button class="btn primary" id="reader-save" data-reader="save">${icon('check')}保存笔记到文献</button><p class="reader-shortcut">Ctrl / ⌘ + S 保存 · 关闭阅读窗口也会保留本机草稿</p></section><section id="reader-translation-panel" class="reader-tool-panel" role="tabpanel" aria-labelledby="reader-tab-translation" hidden><div class="reader-note-intro"><strong>读懂一段，再向前一步。</strong><p>选择论文中的文字，或将段落粘贴到下面；译文可以和原文一起加入笔记。</p></div><div class="reader-language-row"><label>原文<select id="reader-from">${languageOptions('en')}</select></label><button class="icon-btn" data-reader="swap" aria-label="交换翻译语言">${icon('refresh')}</button><label>译文<select id="reader-to">${languageOptions('zh-CN')}</select></label></div><label class="reader-engine-label">翻译方式<select id="reader-engine"><option value="online">MyMemory 在线翻译</option><option value="native" ${this.translator.native?'selected':''}>浏览器本机翻译</option></select></label><p id="reader-translation-disclosure" class="reader-disclosure"></p><label for="reader-translation-source">待翻译段落</label><textarea id="reader-translation-source" maxlength="3000" placeholder="从 PDF 选择文字，或粘贴英文段落…"></textarea><div class="button-row">${button('翻译段落','translate','refresh','primary')}<button class="btn small-btn" id="reader-stop" data-reader="stop-translation" hidden>停止</button></div><p id="reader-translation-status" class="reader-translation-status" role="status"></p><label for="reader-translation-result">译文（可自行校订）</label><textarea id="reader-translation-result" placeholder="译文会显示在这里，可直接修改术语。"></textarea><button class="btn" data-reader="insert-translation" id="reader-insert-translation" disabled>${icon('note')}原文和译文加入笔记</button><p class="reader-shortcut">机器翻译供阅读参考，专业术语可在译文中自行修订。</p></section><p id="reader-error" class="reader-error" role="alert"></p></aside></div>`;
  }
  libraryOptions(){return '<option value="">从课题组资料库选择 PDF</option>'+this.files().map(f=>`<option value="${esc(f.id)}" ${this.selectedFileId===f.id?'selected':''}>${esc(f.name)}</option>`).join('');}
  tab(name){
    this.activeTab=name;
    for(const tab of ['notes','translation']){const active=tab===name;const button=this.$(`#reader-tab-${tab}`);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;this.$(`#reader-${tab}-panel`).hidden=!active;}
    if(name==='translation')this.disclosure();
  }
  disclosure(){this.$('#reader-translation-disclosure').textContent=this.$('#reader-engine').value==='native'?'本机翻译不发送论文文字；首次使用可能需要浏览器下载语言模型。':'在线翻译只将本次待译文字发送给 MyMemory，不发送整份 PDF、个人笔记或 GitHub 令牌。';}
  error(message){if(this.dialog.open)this.$('#reader-error').textContent=message;}
  async change(e){
    if(e.target.id==='reader-file'&&e.target.files.length){await this.loadPdf(e.target.files[0],e.target.files[0].name,{kind:'local'});this.$('#reader-library').value=this.selectedFileId||'';await this.saveDraft();}
    if(e.target.id==='reader-library'&&e.target.value){const file=this.files().find(f=>f.id===e.target.value);await this.loadPdf(await this.context.storage.download(file),file.name,{kind:'library',fileId:file.id});await this.saveDraft();}
    if(e.target.id==='reader-page'&&this.pdf){this.pageNumber=Math.min(this.pdf.numPages,Math.max(1,Number(e.target.value)||1));await this.renderPage();this.scheduleDraft();}
    if(e.target.id==='reader-zoom'){this.zoom=Number(e.target.value);await this.renderPage();}
    if(e.target.id==='reader-engine')this.disclosure();
    if(e.target.id==='reader-bilingual-engine'){this.bilingualEngine=e.target.value;await this.context.storage.write([['reader-bilingual-options',{engine:this.bilingualEngine}]]);this.applyView(true);}
    if(['reader-from','reader-to'].includes(e.target.id)){this.$('#reader-translation-result').value='';this.$('#reader-insert-translation').disabled=true;}
  }
  async action(name){
    this.error('');
    if(name==='view-bilingual'||name==='view-pdf'){this.viewMode=name==='view-bilingual'?'bilingual':'pdf';this.selection='';for(const action of ['quote','translate-selection'])this.$(`[data-reader="${action}"]`).disabled=true;return this.applyView();}
    if(name==='retry-bilingual'){this.viewMode='bilingual';return this.applyView(true);}
    if(name==='close')return this.close();if(name==='choose-file'){this.$('#reader-file').click();return;}if(name==='tab-notes')return this.tab('notes');if(name==='tab-translation')return this.tab('translation');
    if(name==='open-url')return this.loadUrl(this.$('#reader-pdf-url').value);
    if(name==='previous'||name==='next'){if(!this.pdf)return;this.pageNumber=Math.max(1,Math.min(this.pdf.numPages,this.pageNumber+(name==='next'?1:-1)));await this.renderPage();return this.scheduleDraft();}
    if(name==='quote'){if(!this.selection)throw new Error('请先选择论文中的文字。');this.append(formatExcerpt(this.selection,this.pageNumber));return;}
    if(name==='translate-selection'){if(!this.selection)throw new Error('请先选择论文中的文字。');if(this.selection.length>3000)throw new Error('所选内容超过 3000 字符，请每次选择一到两段进行翻译。');this.$('#reader-translation-source').value=this.selection;this.translationPage=this.pageNumber;this.tab('translation');return this.translate();}
    if(name==='translate')return this.translate();
    if(name==='stop-translation'){this.translationController?.abort();return;}
    if(name==='insert-translation'){const source=this.$('#reader-translation-source').value.trim(),translated=this.$('#reader-translation-result').value.trim();if(!source||!translated)throw new Error('请先完成一段翻译。');return this.append(formatExcerpt(source,this.translationPage||this.pageNumber,translated));}
    if(name==='swap'){const from=this.$('#reader-from'),to=this.$('#reader-to');[from.value,to.value]=[to.value,from.value];return;}
    if(name==='template'){this.append('## 研究问题\n\n\n## 核心方法\n\n\n## 关键结论\n\n\n## 我的思考与下一步\n\n');return;}
    if(name==='export'){this.download(`${this.paper().title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100)}_阅读笔记.md`,notesMarkdown(this.paper(),this.$('#reader-notes').value,this.pageNumber));return;}
    if(name==='save')return this.save();
    if(name==='upload')return this.upload();
  }
  append(text){const input=this.$('#reader-notes');if(input.value.length+text.length>100000)throw new Error('笔记长度超过十万字，请先导出整理。');input.value+=(input.value?'\n\n':'')+text;this.tab('notes');input.focus();input.selectionStart=input.selectionEnd=input.value.length;this.scheduleDraft();}
  scheduleDraft(){clearTimeout(this.draftTimer);this.$('#reader-draft-status').textContent='正在保存本机草稿…';this.$('#reader-note-count').textContent=`${this.$('#reader-notes').value.length} 字符`;this.draftTimer=setTimeout(()=>this.saveDraft().catch(error=>this.error(error.message)),300);}
  async saveDraft(){
    if(!this.dialog.open)return;clearTimeout(this.draftTimer);
    const notes=this.$('#reader-notes').value,session=this.session;
    try{await this.context.storage.write([[this.key,{notes,page:this.pageNumber,pdfFileId:this.selectedFileId||'',sourceUrl:this.sourceUrl||'',baseNotes:this.baseNotes,dirty:notes!==this.baseNotes,updatedAt:Date.now()}]]);if(session!==this.session||!this.dialog.open)return;this.lastDraft=notes;this.draftFailed=false;this.$('#reader-draft-status').textContent=notes===this.baseNotes?'笔记已保存 · 阅读位置已记住':'草稿已保存到本设备 · 待保存到文献';}
    catch{this.draftFailed=true;this.$('#reader-draft-status').textContent='草稿保存失败，请复制笔记或导出备份';throw new Error('浏览器无法保存草稿。请复制或导出笔记，避免丢失。');}
  }
  async save(){
    if(this.busy)return;this.busy=true;const button=this.$('#reader-save');button.disabled=true;button.textContent='正在保存…';
    const notes=this.$('#reader-notes').value;
    try{await this.context.savePaper(this.paperId,{readingNotes:notes,readingPage:this.pageNumber,pdfFileId:this.selectedFileId||'',pdfUrl:this.sourceUrl||this.paper().pdfUrl||'',readingNotesUpdatedAt:new Date().toISOString()});this.baseNotes=notes;await this.saveDraft();this.$('#reader-draft-status').textContent=this.$('#reader-notes').value!==notes?'上一版已保存，新修改已保留为本机草稿':this.context.isDemo()?'演示笔记已保存':this.context.storage.label();}
    finally{this.busy=false;button.disabled=false;button.innerHTML=icon('check')+'保存笔记到文献';}
  }
  async upload(){
    if(!this.localBlob)return;if(this.context.isDemo())throw new Error('演示模式仅在本设备预览 PDF，不上传真实资料。');if(this.busy)return;
    this.busy=true;const button=this.$('#reader-upload');button.disabled=true;button.textContent='正在上传…';
    try{const id=await this.context.uploadPdf(this.paperId,this.localBlob,this.localName);this.selectedFileId=id;await this.context.savePaper(this.paperId,{pdfFileId:id});this.$('#reader-library').innerHTML=this.libraryOptions();await this.context.storage.write([[this.pdfKey,{blob:this.localBlob,name:this.localName,kind:'library',fileId:id}]]);await this.saveDraft();this.context.notify('PDF 已保存并关联到这篇文献。');}
    finally{this.busy=false;button.innerHTML=icon('upload')+'保存 PDF 到资料库';button.disabled=Boolean(this.selectedFileId);}
  }
  async translate(){
    this.translationController?.abort();const controller=new AbortController();this.translationController=controller;const session=this.session;
    const button=this.$('[data-reader="translate"]');button.disabled=true;this.$('#reader-stop').hidden=false;this.$('#reader-insert-translation').disabled=true;this.$('#reader-translation-result').value='';
    for(const selector of ['#reader-translation-source','#reader-from','#reader-to','#reader-engine'])this.$(selector).disabled=true;
    this.translationPage=this.pageNumber;
    try{const translated=await this.translator.translate(this.$('#reader-translation-source').value,{from:this.$('#reader-from').value,to:this.$('#reader-to').value,engine:this.$('#reader-engine').value,signal:controller.signal,onProgress:message=>{if(this.dialog.open&&session===this.session&&this.translationController===controller)this.$('#reader-translation-status').textContent=message;}});if(session!==this.session||!this.dialog.open||controller.signal.aborted||this.translationController!==controller)return;this.$('#reader-translation-result').value=translated;this.$('#reader-translation-status').textContent='翻译完成，可校订后加入笔记。';this.$('#reader-insert-translation').disabled=false;}
    catch(error){if(this.dialog.open&&session===this.session&&this.translationController===controller)this.$('#reader-translation-status').textContent=controller.signal.aborted?'翻译已停止。':error.message;}
    finally{if(session===this.session&&this.dialog.open&&this.translationController===controller){button.disabled=false;this.$('#reader-stop').hidden=true;for(const selector of ['#reader-translation-source','#reader-from','#reader-to','#reader-engine'])this.$(selector).disabled=false;}}
  }
  async loadUrl(value){
    let url;try{url=new URL(value.trim());}catch{throw new Error('请填写可直接下载的 HTTPS PDF 链接。');}
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('PDF 链接须为 HTTPS，且不能包含账号密码。');
    this.pdfMessage('正在获取 PDF…');const session=this.session,source=++this.sourceSequence;this.fetchController?.abort();this.fetchController=new AbortController();
    try{
      const response=await fetch(url.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([this.fetchController.signal,AbortSignal.timeout(30000)])});if(!response.ok)throw new Error('PDF 链接返回错误。');
      if(Number(response.headers.get('content-length'))>MAX_PDF)throw new Error('PDF 不能超过 20 MB。');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_PDF){await reader.cancel();throw new Error('PDF 不能超过 20 MB。');}chunks.push(value);}
      if(session!==this.session||source!==this.sourceSequence)return;await this.loadPdf(new Blob(chunks,{type:'application/pdf'}),decodeURIComponent(url.pathname.split('/').pop()||'paper.pdf'),{kind:'url',sourceUrl:url.href},source);await this.saveDraft();
    }catch(error){if(session===this.session&&source===this.sourceSequence)this.pdfError(error.message==='PDF 不能超过 20 MB。'?error.message:'此链接无法直接读取 PDF，可能是论文网页或站点不允许跨站访问。请通过“原文”下载 PDF，再用“打开本机 PDF”阅读；你的笔记不受影响。');}
  }
  pdfMessage(text){const target=this.$('#reader-pdf-message');target.hidden=false;target.textContent=text;this.$('#reader-page-surface').hidden=true;this.$('#reader-bilingual').hidden=true;}
  pdfError(message){this.pdfMessage(message);this.$('#reader-pdf-name').textContent='PDF 尚未载入，仍可记录笔记';}
  async loadPdf(blob,name,metadata,source=++this.sourceSequence){
    this.fetchController?.abort();
    if(blob.size>MAX_PDF)throw new Error('单个 PDF 不能超过 20 MB。');
    const signature=new TextDecoder('latin1').decode(await blob.slice(0,1024).arrayBuffer());if(!signature.includes('%PDF-'))throw new Error('这个文件不是可识别的 PDF。请选择 PDF 文件，阅读笔记会继续保留。');
    if(source!==this.sourceSequence||!this.dialog.open)return;
    const session=this.session;this.pdfMessage('正在解析 PDF…');await this.disposePdf();
    this.pdfModulePromise||=import('./vendor/pdfjs/pdf.min.mjs');const pdfjs=await this.pdfModulePromise;if(session!==this.session||!this.dialog.open||source!==this.sourceSequence)return;
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
    const bytes=new Uint8Array(await blob.arrayBuffer());if(session!==this.session||source!==this.sourceSequence)return;
    const base=new URL('./vendor/pdfjs/',import.meta.url);
    const task=pdfjs.getDocument({data:bytes,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,wasmUrl:new URL('wasm/',base).href,isEvalSupported:false,enableXfa:false});
    this.loadingTask=task;
    try{const pdf=await task.promise;if(session!==this.session||!this.dialog.open||source!==this.sourceSequence){await task.destroy();return;}this.pdf=pdf;this.localBlob=blob;this.localName=name;this.selectedFileId=metadata.fileId||'';this.sourceUrl=metadata.sourceUrl||'';this.pageNumber=Math.min(pdf.numPages,Math.max(1,this.pageNumber));try{await this.context.storage.write([[this.pdfKey,{blob,name,...metadata}]]);}catch{this.error('PDF 已打开但无法缓存在本设备，关闭后需要重新选择文件。');}this.$('#reader-pdf-name').textContent=name;this.$('#reader-upload').disabled=Boolean(this.selectedFileId);this.$('#reader-page').disabled=false;await this.renderPage();}
    catch(error){if(session===this.session&&this.dialog.open&&source===this.sourceSequence)this.pdfError(error.name==='PasswordException'?'此 PDF 需要密码，请使用可直接打开的 PDF 版本。':'PDF 无法解析，请重新选择文件。阅读笔记仍然保留。');}
  }
  renderPage(){
    if(this.bilingualPageNumber!==this.pageNumber){this.bilingual?.cancel();this.currentPageContent=null;this.bilingualPageNumber=this.pageNumber;this.pdfMessage(`正在读取第 ${this.pageNumber} 页…`);}
    const sequence=++this.renderSequence;this.renderTask?.cancel();
    this.renderPromise=(this.renderPromise||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(sequence!==this.renderSequence||!this.pdf||!this.dialog.open)return;
      const session=this.session,number=this.pageNumber,pdf=this.pdf;
      try{
        const page=await pdf.getPage(number);if(sequence!==this.renderSequence||session!==this.session)return;
        const available=Math.max(190,this.$('#reader-pdf-scroll').clientWidth-42);const natural=page.getViewport({scale:1});const scale=Math.max(.2,Math.min(2.5,available/natural.width))*this.zoom;
        const viewport=page.getViewport({scale});const ratio=Math.min(2,window.devicePixelRatio||1),canvas=this.$('#reader-canvas'),surface=this.$('#reader-page-surface'),layer=this.$('.textLayer');
        surface.hidden=this.viewMode!=='pdf';this.$('#reader-pdf-message').hidden=this.viewMode==='pdf';surface.style.width=viewport.width+'px';surface.style.height=viewport.height+'px';surface.style.setProperty('--scale-factor',String(scale));surface.style.setProperty('--total-scale-factor',String(scale));
        canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';layer.replaceChildren();this.selection='';
        for(const name of ['quote','translate-selection'])this.$(`[data-reader="${name}"]`).disabled=true;
        this.$('#reader-selection').textContent='在论文中选择文字，即可摘录或翻译';
        this.renderTask=page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});await this.renderTask.promise;
        if(sequence!==this.renderSequence||session!==this.session)return;
        const content=await page.getTextContent();this.pageText=content.items.map(item=>item.str||'').join(' ');
        if(!this.pageText.trim())this.$('#reader-selection').textContent='此页没有可选文字，可在翻译栏手动粘贴；目前不包含 OCR。';
        this.textLayer?.cancel();this.textLayer=new this.pdfModule.TextLayer({textContentSource:content,container:layer,viewport});await this.textLayer.render();
        this.$('#reader-page').value=String(number);this.$('#reader-page').max=String(pdf.numPages);this.$('#reader-page-count').textContent=String(pdf.numPages);this.$('[data-reader="previous"]').disabled=number<=1;this.$('[data-reader="next"]').disabled=number>=pdf.numPages;
        this.currentPageContent=content;this.applyView();this.$('#reader-bilingual-retry').disabled=!this.pageText.trim();
        this.$('#reader-pdf-scroll').scrollTop=0;
      }catch(error){if(sequence===this.renderSequence&&this.dialog.open&&error.name!=='RenderingCancelledException')this.error('此页渲染失败，可以翻页或重新打开 PDF；笔记不会被清除。');}
    });return this.renderPromise;
  }
  applyView(force=false){
    const bilingual=this.viewMode==='bilingual';
    this.$('[data-reader="view-bilingual"]').setAttribute('aria-pressed',String(bilingual));this.$('[data-reader="view-pdf"]').setAttribute('aria-pressed',String(!bilingual));
    if(!this.pdf||!this.currentPageContent)return;
    this.$('#reader-pdf-message').hidden=true;this.$('#reader-page-surface').hidden=bilingual;this.$('#reader-bilingual').hidden=!bilingual;
    if(bilingual){this.$('#reader-bilingual').style.setProperty('--bilingual-font-size',`${14*this.zoom}px`);this.$('#reader-selection').textContent=this.pageText.trim()?'当前页自动中英对照 · 可以逐段加入笔记':'此页没有可选文字，可切换原版 PDF 查看';this.bilingual.start(this.currentPageContent,{page:this.pageNumber,documentId:this.pdf.fingerprints?.[0]||this.paperId,preference:this.bilingualEngine,force});}
    else{this.bilingual.cancel();this.$('#reader-selection').textContent='在原版 PDF 中选择文字，即可摘录或翻译';}
  }
  async disposePdf(){this.bilingual?.clear();this.currentPageContent=null;this.bilingualPageNumber=0;this.renderSequence++;this.renderTask?.cancel();this.textLayer?.cancel();try{await this.renderPromise;}catch{}const task=this.loadingTask;this.loadingTask=null;this.pdf=null;if(task)try{await task.destroy();}catch{}}
  get pdfModule(){return this._pdfModule;}
  set pdfModulePromise(promise){this._pdfPromise=promise.then(module=>{this._pdfModule=module;return module;});}
  get pdfModulePromise(){return this._pdfPromise;}
  async close(){
    if(!this.dialog.open)return;if(this.busy)throw new Error('正在保存笔记或上传 PDF，请稍候再关闭。');
    try{await this.saveDraft();}catch(error){if(!confirm('本机草稿保存失败。请先复制或导出笔记；仍然关闭阅读窗口吗？'))return;}
    this.session++;this.sourceSequence++;clearTimeout(this.draftTimer);clearTimeout(this.resizeTimer);this.resizeObserver?.disconnect();this.translationController?.abort();this.bilingual?.cancel();this.fetchController?.abort();this.dialog.close();await this.disposePdf();
  }
  download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
