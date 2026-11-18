const KEY='bookshelf_books_v1';
let books=JSON.parse(localStorage.getItem(KEY)||'[]');
let currentFilter='all';
let scannerControls=null,zxingReader=null,scanLocked=false,candidateISBN='',candidateHits=0,candidateSince=0,scanVideo=null;
let shelfCandidates=[], shelfWorker=null;

const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
function save(){localStorage.setItem(KEY,JSON.stringify(books))}
function nav(id){
  $$('.screen').forEach(x=>x.classList.remove('active'));
  $('#'+id).classList.add('active');
  $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.nav===id));
  if(id!=='scan')stopCamera();
  renderAll();
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function counts(){
  let o=books.filter(b=>b.status==='Owned').length,w=books.filter(b=>b.status==='Want to Buy').length,r=books.filter(b=>b.status==='Read').length;
  $('#bookCount').textContent=books.length;$('#ownedCount').textContent=o;$('#wantCount').textContent=w;$('#readCount').textContent=r;
}
function card(b){
  return `<article class="book" onclick="showDetails('${b.id}')">${b.cover?`<img class="cover" src="${esc(b.cover)}">`:`<div class="cover noCover">No cover image</div>`}<div class="bookInfo"><div class="bookTitle">${esc(b.title)}</div><div class="author">${esc(b.author||'Unknown author')}</div><span class="badge">${esc(b.status||'Owned')}</span></div></article>`;
}
function renderAll(){
  counts();
  let recent=[...books].sort((a,b)=>b.added-a.added).slice(0,6);
  $('#recent').innerHTML=recent.length?recent.map(card).join(''):`<div class="empty"><b>Your library is empty</b>Scan your first book to get started.</div>`;
  renderLibrary();
  $('#wantList').innerHTML=books.filter(b=>b.status==='Want to Buy').map(card).join('')||`<div class="empty"><b>No books on your list</b><span>Scan a book and add it to Want to Buy.</span></div>`;
}
function renderLibrary(){
  let q=($('#search')?.value||'').toLowerCase(),map={owned:'Owned',want:'Want to Buy',read:'Read'};
  let arr=books.filter(b=>currentFilter==='all'||b.status===map[currentFilter]).filter(b=>(b.title+' '+b.author+' '+b.isbn).toLowerCase().includes(q));
  $('#libraryList').innerHTML=arr.length?arr.map(card).join(''):`<div class="empty"><b>No matching books</b><span>Try another search or scan a book.</span></div>`;
}
function showDetails(id){
  let b=books.find(x=>x.id===id);if(!b)return;
  $('#detailsContent').innerHTML=`<div class="detailHero">${b.cover?`<img class="detailCover" src="${esc(b.cover)}">`:`<div class="detailCover noCover">No cover</div>`}<div class="detailMeta"><h2>${esc(b.title)}</h2><p><b>${esc(b.author||'Unknown author')}</b></p><p>ISBN: ${esc(b.isbn||'')}</p><p>${esc(b.publisher||'')} ${b.year?'• '+esc(b.year):''}</p></div></div><div class="detailActions"><button class="action primaryAction" onclick="cycleStatus('${b.id}')">${esc(b.status)}</button><button class="action" onclick="removeBook('${b.id}')">Delete</button></div><div class="description">${esc(b.description||'No description available.')}</div><div class="field"><label>Where I bought it</label><input id="storeField" value="${esc(b.store||'')}" placeholder="Bookstore, thrift store, etc."></div><div class="field"><label>Price paid</label><input id="priceField" inputmode="decimal" value="${esc(b.price||'')}" placeholder="$0.00"></div><div class="field"><label>Personal notes</label><textarea id="notesField" rows="4" placeholder="Notes about this book...">${esc(b.notes||'')}</textarea></div><button class="primary big" style="margin-top:14px" onclick="saveDetails('${b.id}')">Save Changes</button>`;
  nav('details');
}
function saveDetails(id){let b=books.find(x=>x.id===id);b.store=$('#storeField').value;b.price=$('#priceField').value;b.notes=$('#notesField').value;save();alert('Book updated.');showDetails(id)}
function cycleStatus(id){let b=books.find(x=>x.id===id),s=['Owned','Want to Buy','Reading','Read'];b.status=s[(s.indexOf(b.status)+1)%s.length];save();showDetails(id)}
function removeBook(id){if(confirm('Remove this book from your library?')){books=books.filter(x=>x.id!==id);save();nav('library')}}
function cleanISBN(v){return String(v||'').replace(/[^0-9Xx]/g,'').toUpperCase()}
function isbn10to13(isbn){isbn=cleanISBN(isbn);if(isbn.length!==10)return isbn;return '978'+isbn.slice(0,9)}
function isbn13Check(s){let sum=0;for(let i=0;i<12;i++)sum+=Number(s[i])*(i%2?3:1);return String((10-(sum%10))%10)===s[12]}
function normalizeISBN(isbn){
  isbn=cleanISBN(isbn);
  if(isbn.length===10){let base=isbn10to13(isbn);if(/^\d{13}$/.test(base))return base}
  return isbn
}
function isDuplicate(isbn,title,author){
  const ni=normalizeISBN(isbn);
  return books.find(b=>{
    const bi=normalizeISBN(b.isbn);
    if(ni && /^\d{13}$/.test(ni) && bi===ni)return b;
    return title&&author&&b.title&&b.author&&b.title.toLowerCase().trim()===title.toLowerCase().trim()&&b.author.toLowerCase().trim()===author.toLowerCase().trim();
  });
}
async function googleBooks(q){
  const url='https://www.googleapis.com/books/v1/volumes?maxResults=8&q='+encodeURIComponent(q);
  const r=await fetch(url);if(!r.ok)throw new Error('Google Books unavailable');const d=await r.json();return d.items||[];
}
function gbToBook(item,ocr=''){
  const v=item.volumeInfo||{},ids=v.industryIdentifiers||[],isbn=(ids.find(x=>x.type==='ISBN_13')||ids.find(x=>x.type==='ISBN_10')||{}).identifier||'';
  return {isbn:normalizeISBN(isbn),title:v.title||'',author:(v.authors||[]).join(', '),cover:v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'',publisher:v.publisher||'',year:v.publishedDate||'',description:v.description||'',ocr};
}
async function lookup(isbn,statusChoice='Owned'){
  isbn=cleanISBN(isbn);if(isbn.length!==10&&isbn.length!==13){alert('Please enter a valid ISBN-10 or ISBN-13.');return}
  let normalized=normalizeISBN(isbn),existing=isDuplicate(normalized,'','');
  if(existing){await stopCamera();showDetails(existing.id);alert(existing.status==='Owned'?'You already have this book in your library.':'This book is already on your Want to Buy list.');return}
  $('#scanMsg').textContent='ISBN confirmed — looking up book…';
  try{
    let item=(await googleBooks('isbn:'+normalized))[0];
    if(!item){
      let r=await fetch('https://openlibrary.org/isbn/'+encodeURIComponent(isbn)+'.json');
      if(!r.ok)throw new Error('Book not found');
      let d=await r.json(),desc='',works=d.works?.[0]?.key;
      if(works)try{let wd=await(await fetch('https://openlibrary.org'+works+'.json')).json();desc=typeof wd.description==='string'?wd.description:(wd.description?.value||'')}catch(e){}
      let b={id:crypto.randomUUID(),isbn:normalized,title:d.title||'Unknown title',author:(d.authors||[]).map(a=>a.name||'').filter(Boolean).join(', '),cover:`https://covers.openlibrary.org/b/isbn/${normalized}-L.jpg`,publisher:(d.publishers||[])[0]||'',year:d.publish_date||'',description:desc,status:statusChoice,added:Date.now(),store:'',price:'',notes:''};
      books.unshift(b);save();await stopCamera();showDetails(b.id);return;
    }
    let b=gbToBook(item);b.id=crypto.randomUUID();b.status=statusChoice;b.added=Date.now();b.store='';b.price='';b.notes='';
    books.unshift(b);save();await stopCamera();showDetails(b.id);
  }catch(e){$('#scanMsg').textContent='Book not found. Try another angle or enter the ISBN manually.';alert('I could not find that ISBN. Try the manual ISBN field or another edition.')}
}
function resetCandidate(){candidateISBN='';candidateHits=0;candidateSince=0}
async function startCamera(){
  await stopCamera();nav('scan');scanLocked=false;resetCandidate();$('#scanMsg').textContent='Starting camera…';
  const oldVideo=$('#video');if(!oldVideo)return;oldVideo.style.display='none';const parent=oldVideo.parentElement;let prior=$('#zxing-video');if(prior)prior.remove();
  scanVideo=document.createElement('video');scanVideo.id='zxing-video';scanVideo.setAttribute('playsinline','true');scanVideo.setAttribute('autoplay','true');scanVideo.muted=true;
  scanVideo.style.cssText='display:block;width:100%;height:100%;min-height:260px;object-fit:cover;border-radius:12px;background:#111';parent.appendChild(scanVideo);
  try{
    $('#scanMsg').textContent='Loading barcode reader…';
    const browserMod=await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm'),libMod=await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
    const hints=new Map();hints.set(libMod.DecodeHintType.POSSIBLE_FORMATS,[libMod.BarcodeFormat.EAN_13,libMod.BarcodeFormat.EAN_8]);hints.set(libMod.DecodeHintType.TRY_HARDER,true);
    zxingReader=new browserMod.BrowserMultiFormatReader(hints,120);
    const constraints={audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30},focusMode:'continuous'}};
    scannerControls=await zxingReader.decodeFromConstraints(constraints,scanVideo,(result,error)=>{
      if(scanLocked||!result)return;const raw=result.getText(),isbn=cleanISBN(raw);if(isbn.length!==13)return;const now=Date.now();
      if(isbn===candidateISBN&&now-candidateSince<2200)candidateHits++;else{candidateISBN=isbn;candidateHits=1;candidateSince=now}
      $('#scanMsg').textContent=`Barcode detected — confirming ISBN (${Math.min(candidateHits,2)}/2). Hold steady.`;
      if(candidateHits>=2){scanLocked=true;$('#scanMsg').textContent='ISBN confirmed. Looking up book…';lookup(isbn)}
    });
    $('#scanMsg').textContent='Center the whole barcode in the camera view. Hold steady; avoid glare and shadows.';
  }catch(e){console.error(e);$('#scanMsg').textContent='Could not start the scanner. Check Safari camera permission, then refresh. You can enter the ISBN manually below.';if(scanVideo){scanVideo.remove();scanVideo=null}oldVideo.style.display=''}
}
async function stopCamera(){
  if(scannerControls){try{scannerControls.stop()}catch(e){}scannerControls=null}
  if(zxingReader){try{zxingReader.reset()}catch(e){}zxingReader=null}
  if(scanVideo){try{scanVideo.pause();if(scanVideo.srcObject)scanVideo.srcObject.getTracks().forEach(t=>t.stop())}catch(e){}scanVideo.remove();scanVideo=null}
  const oldVideo=$('#video');if(oldVideo){oldVideo.srcObject=null;oldVideo.style.display=''}
  resetCandidate();scanLocked=false
}

/* ---------- Shelf Scan v3 ---------- */
function setShelfStatus(msg,pct){$('#shelfStatus').textContent=msg;$('#shelfProgress').style.width=(pct||0)+'%'}
function imageFromFile(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(u);res(im)};im.onerror=rej;im.src=u})}
function canvasFromImage(im,maxW=1500){
  const scale=Math.min(1,maxW/im.naturalWidth),c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*scale);c.height=Math.round(im.naturalHeight*scale);c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c
}
function rotateCanvas(src,deg){
  const c=document.createElement('canvas'),ctx=c.getContext('2d'),r=Math.abs(deg)%180===90;c.width=r?src.height:src.width;c.height=r?src.width:src.height;
  ctx.translate(c.width/2,c.height/2);ctx.rotate(deg*Math.PI/180);ctx.drawImage(src,-src.width/2,-src.height/2);return c
}
async function ocrWords(c,rotation){
  const rc=rotateCanvas(c,rotation);
  const result=await shelfWorker.recognize(rc,{rotateAuto:true});
  const words=(result.data.words||[]).filter(w=>w.text&&w.text.trim()&&w.confidence>=18);
  return {rotation,canvas:rc,words,result};
}
function cleanOCR(s){return String(s||'').replace(/[^A-Za-z0-9À-ÿ'&:,\- ]/g,' ').replace(/\s+/g,' ').trim()}
function scoreText(a,b){
  a=cleanOCR(a).toLowerCase();b=cleanOCR(b).toLowerCase();if(!a||!b)return 0;
  const at=new Set(a.split(/\s+/).filter(x=>x.length>2)),bt=new Set(b.split(/\s+/).filter(x=>x.length>2));let hit=0;at.forEach(x=>{if(bt.has(x))hit++});return hit/Math.max(1,Math.min(at.size,bt.size))
}
function clusterWords(words,canvas){
  // Words are horizontal in the OCR canvas. Their x positions group text belonging to one spine.
  let arr=words.map(w=>({x:(w.bbox.x0+w.bbox.x1)/2,y:(w.bbox.y0+w.bbox.y1)/2,w:w.bbox.x1-w.bbox.x0,h:w.bbox.y1-w.bbox.y0,text:cleanOCR(w.text),conf:w.confidence})).filter(x=>x.text.length>=2);
  arr.sort((a,b)=>a.x-b.x);
  const groups=[];const tolerance=Math.max(28,canvas.width*.035);
  for(const item of arr){
    let g=groups[groups.length-1];
    if(!g||item.x-g.maxX>tolerance){groups.push({minX:item.x,maxX:item.x,items:[item]})}
    else{g.items.push(item);g.maxX=Math.max(g.maxX,item.x)}
  }
  // Merge close groups and discard tiny/noisy clusters.
  let merged=[];
  for(const g of groups){
    const width=g.maxX-g.minX;const count=g.items.length;
    if(count>=2 || width>30){
      const prev=merged[merged.length-1];
      if(prev&&g.minX-prev.maxX<Math.max(35,canvas.width*.045)){prev.items.push(...g.items);prev.maxX=Math.max(prev.maxX,g.maxX)}
      else merged.push({minX:g.minX,maxX:g.maxX,items:g.items})
    }
  }
  return merged;
}
function cropGroup(c,g){
  const xs=g.items.map(x=>x.x),ys=g.items.map(x=>x.y);
  const minX=Math.max(0,Math.floor(Math.min(...xs)-Math.max(45,c.width*.035))),maxX=Math.min(c.width,Math.ceil(Math.max(...xs)+Math.max(45,c.width*.035)));
  const minY=Math.max(0,Math.floor(Math.min(...ys)-Math.max(55,c.height*.04))),maxY=Math.min(c.height,Math.ceil(Math.max(...ys)+Math.max(55,c.height*.04)));
  const out=document.createElement('canvas');out.width=maxX-minX;out.height=maxY-minY;out.getContext('2d').drawImage(c,minX,minY,out.width,out.height,0,0,out.width,out.height);return out;
}
function combineCandidateText(items){return cleanOCR(items.map(x=>x.text).join(' '))}
async function identifySpines(base){
  const rotations=[0,90,-90];let clusters=[];
  for(let i=0;i<rotations.length;i++){
    setShelfStatus(`Reading shelf text (${i+1}/${rotations.length})…`,20+i*15);
    const r=await ocrWords(base,rotations[i]);clusters.push({rotation:r.rotation,canvas:r.canvas,groups:clusterWords(r.words,r.canvas)});
  }
  // Prefer the rotation with the most useful groups.
  clusters.sort((a,b)=>b.groups.length-a.groups.length);
  const chosen=clusters[0];const results=[];
  for(let i=0;i<Math.min(chosen.groups.length,20);i++){
    const g=chosen.groups[i],raw=combineCandidateText(g.items);if(raw.length<3)continue;
    const crop=cropGroup(chosen.canvas,g);
    results.push({raw,crop});
  }
  return results;
}
async function searchShelfText(raw){
  const words=raw.split(/\s+/).filter(w=>w.length>2);
  const queries=[];
  if(words.length>=2)queries.push(words.slice(0,7).join(' '));
  if(words.length>7)queries.push(words.slice(-7).join(' '));
  let items=[];
  for(const q of queries){try{items.push(...await googleBooks(q))}catch(e){}}
  const unique=[];const seen=new Set();
  for(const it of items){const id=it.id||JSON.stringify(it.volumeInfo);if(!seen.has(id)){seen.add(id);unique.push(it)}}
  unique.sort((a,b)=>{
    const av=a.volumeInfo||{},bv=b.volumeInfo||{};
    const as=scoreText(raw,(av.title||'')+' '+(av.authors||[]).join(' ')),bs=scoreText(raw,(bv.title||'')+' '+(bv.authors||[]).join(' '));return bs-as
  });
  return unique.slice(0,4).map(it=>gbToBook(it,raw));
}
async function shelfProcess(file){
  $('#shelfWork').classList.remove('hidden');$('#shelfResults').innerHTML='';$('#ocrDebug').classList.add('hidden');shelfCandidates=[];
  try{
    const im=await imageFromFile(file),base=canvasFromImage(im,1500);$('#shelfPreview').src=base.toDataURL('image/jpeg',.85);
    setShelfStatus('Preparing shelf image…',5);
    shelfWorker=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text'&&m.progress)setShelfStatus('Reading shelf text…',25+m.progress*35)}});
    await shelfWorker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'});
    const spines=await identifySpines(base);setShelfStatus(`Found ${spines.length} possible book regions. Matching titles…`,65);
    let debug=[];
    for(let i=0;i<spines.length;i++){
      const s=spines[i];debug.push(`Region ${i+1}: ${s.raw}`);
      const matches=await searchShelfText(s.raw);setShelfStatus(`Matching book ${i+1} of ${spines.length}…`,65+(i/spines.length)*30);
      if(matches.length){
        const best=matches[0],score=scoreText(s.raw,best.title+' '+best.author),existing=isDuplicate(best.isbn,best.title,best.author);
        shelfCandidates.push({...best,raw:s.raw,score,existing,selected:!existing||existing.status==='Want to Buy'});
      }else{
        shelfCandidates.push({title:'Possible book match',author:'',isbn:'',cover:'',raw:s.raw,score:0,selected:false,needsSearch:true});
      }
    }
    if(shelfWorker){await shelfWorker.terminate();shelfWorker=null}
    setShelfStatus(`Done — ${shelfCandidates.length} book regions found.`,100);
    $('#ocrDebug').innerHTML=`<div class="debugBox"><details><summary>Show OCR text used for matching</summary><div class="debugText">${esc(debug.join('\\n'))}</div></details></div>`;
    $('#ocrDebug').classList.remove('hidden');
    renderShelfResults();
  }catch(e){
    console.error(e);setShelfStatus('Shelf scan could not complete.',0);
    $('#shelfResults').innerHTML=`<div class="empty"><b>Could not scan this photo</b><span>Try a sharper photo with the book spines filling more of the frame.</span></div>`;
    if(shelfWorker){try{await shelfWorker.terminate()}catch(x){}shelfWorker=null}
  }
}
function renderShelfResults(){
  if(!shelfCandidates.length){$('#shelfResults').innerHTML=`<div class="empty"><b>No book regions detected</b><span>Try moving closer so the spines fill more of the photo.</span></div>`;return}
  let html=`<div class="shelfToolbar"><button onclick="selectAllShelf(true)">Select all</button><button onclick="selectAllShelf(false)">Clear all</button></div>`;
  shelfCandidates.forEach((b,i)=>{
    let conf=b.score>=.55?'High confidence':b.score>=.3?'Possible match':'Low confidence',cl=b.score>=.55?'confHigh':b.score>=.3?'confMed':'confLow';
    let state=b.existing?(b.existing.status==='Owned'?'Already in your library':'Already on Want to Buy'):'';
    html+=`<div class="resultCard"><div class="resultTop">${b.cover?`<img class="resultCover" src="${esc(b.cover)}">`:`<div class="resultCover noCover">No cover</div>`}<div class="resultInfo"><div class="resultTitle">${esc(b.title||'Possible book match')}</div><div class="resultAuthor">${esc(b.author||'')}</div><span class="confidence ${cl}">${conf}</span>${state?`<div class="resultAuthor"><b>${esc(state)}</b></div>`:''}</div></div><div class="ocrRead">Read: ${esc(b.raw)}</div><div class="resultActions">${b.existing&&b.existing.status==='Owned'?`<button class="skipBtn" disabled>Already Owned</button>`:`<button class="addBtn" onclick="toggleShelf(${i})">${b.selected?'✓ Selected':'Select'}</button>`}${b.needsSearch?`<button class="searchBtn" onclick="manualShelfSearch(${i})">Search</button>`:`<button class="searchBtn" onclick="toggleShelf(${i})">${b.selected?'Deselect':'Select'}</button>`}</div></div>`;
  });
  html+=`<button class="primary big" onclick="addSelectedShelf()" style="margin-top:8px">Add Selected to Owned</button>`;
  $('#shelfResults').innerHTML=html;
}
function toggleShelf(i){if(shelfCandidates[i].existing&&shelfCandidates[i].existing.status==='Owned')return;shelfCandidates[i].selected=!shelfCandidates[i].selected;renderShelfResults()}
function selectAllShelf(v){shelfCandidates.forEach(x=>{if(!(x.existing&&x.existing.status==='Owned'))x.selected=v});renderShelfResults()}
function manualShelfSearch(i){
  const q=prompt('Enter the title or author for this book:',shelfCandidates[i].raw||'');if(!q)return;
  googleBooks(q).then(items=>{if(!items.length){alert('No matches found.');return}const b=gbToBook(items[0],shelfCandidates[i].raw);b.score=scoreText(shelfCandidates[i].raw,b.title+' '+b.author);b.existing=isDuplicate(b.isbn,b.title,b.author);b.selected=!b.existing;shelfCandidates[i]=b;renderShelfResults()}).catch(()=>alert('Book search failed.'))
}
function addSelectedShelf(){
  let added=0, moved=0;
  for(const b of shelfCandidates){
    if(!b.selected||b.needsSearch)continue;
    if(b.existing&&b.existing.status==='Owned')continue;
    if(b.existing&&b.existing.status==='Want to Buy'){b.existing.status='Owned';b.existing.added=Date.now();moved++;continue}
    if(!b.title)continue;
    books.unshift({id:crypto.randomUUID(),isbn:normalizeISBN(b.isbn||''),title:b.title,author:b.author,cover:b.cover,publisher:b.publisher||'',year:b.year||'',description:b.description||'',status:'Owned',added:Date.now(),store:'',price:'',notes:''});added++;
  }
  save();alert(`${added} book${added===1?'':'s'} added to Owned${moved?` and ${moved} moved from Want to Buy`:''}.`);nav('library');
}

/* events */
$$('nav button').forEach(b=>b.onclick=()=>b.dataset.nav==='scan'?startCamera():nav(b.dataset.nav));
$('#scanHome').onclick=startCamera;$('#scanLib').onclick=startCamera;
$('#shelfHome').onclick=()=>nav('shelf');$('#shelfLib').onclick=()=>nav('shelf');
$('#closeScan').onclick=()=>nav('home');$('#closeShelf').onclick=()=>nav('home');
$('#backDetails').onclick=()=>nav('library');$('#seeAll').onclick=()=>nav('library');
$('#search').oninput=renderLibrary;$('#lookupManual').onclick=()=>lookup($('#manualIsbn').value);
$('#chooseShelf').onclick=()=>$('#shelfFile').click();
$('#shelfFile').onchange=e=>{if(e.target.files[0])shelfProcess(e.target.files[0])};
$$('.chip').forEach(b=>b.onclick=()=>{$$('.chip').forEach(c=>c.classList.remove('active'));b.classList.add('active');currentFilter=b.dataset.filter;renderLibrary()});
$$('.stats button').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;nav('library')});
renderAll();
