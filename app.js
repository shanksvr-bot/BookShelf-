const KEY='bookshelf_books_v1';
let books=JSON.parse(localStorage.getItem(KEY)||'[]');
let currentFilter='all', scannerControls=null, zxingReader=null, scanLocked=false;
let candidateISBN='', candidateHits=0, candidateSince=0, scanVideo=null;

const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
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
  $('#bookCount').textContent=books.length;
  $('#ownedCount').textContent=books.filter(b=>b.status==='Owned').length;
  $('#wantCount').textContent=books.filter(b=>b.status==='Want to Buy').length;
  $('#readCount').textContent=books.filter(b=>b.status==='Read').length;
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
  let q=($('#search')?.value||'').toLowerCase(), map={owned:'Owned',want:'Want to Buy',read:'Read'};
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
function isbn13From10(isbn){let s=cleanISBN(isbn);if(s.length!==10)return s;let base='978'+s.slice(0,9),sum=0;for(let i=0;i<12;i++)sum+=Number(base[i])*(i%2?3:1);return base+(10-(sum%10))%10}
function isbnCandidates(isbn){let s=cleanISBN(isbn),a=[s];if(s.length===10)a.push(isbn13From10(s));if(s.length===13&&s.startsWith('978')){let b=s.slice(3,12),sum=0;for(let i=0;i<9;i++)sum+=Number(b[i])*(i%2?3:1);a.push(b+(10-(sum%10))%10)}return [...new Set(a)]}
function existingByISBN(isbn){let cs=isbnCandidates(isbn);return books.find(b=>cs.includes(cleanISBN(b.isbn))||cs.some(x=>isbnCandidates(b.isbn).includes(x)))}
async function fetchJSON(url){let r=await fetch(url);if(!r.ok)throw new Error('HTTP '+r.status);return await r.json()}
async function lookupBookData(isbn){
  let cs=isbnCandidates(isbn), best=null;
  for(const x of cs){
    try{
      let g=await fetchJSON('https://www.googleapis.com/books/v1/volumes?q=isbn:'+encodeURIComponent(x));
      let item=g.items?.[0];if(item){
        let v=item.volumeInfo||{}, title=v.title||'Unknown title', authors=(v.authors||[]).join(', ');
        best={isbn:x,title,author:authors,cover:v.imageLinks?.thumbnail?.replace('http:','https:')||'',publisher:v.publisher||'',year:v.publishedDate||'',description:v.description||''};
        break;
      }
    }catch(e){}
  }
  if(best)return best;
  for(const x of cs){
    try{
      let d=await fetchJSON('https://openlibrary.org/isbn/'+encodeURIComponent(x)+'.json');
      let desc='',works=d.works?.[0]?.key;if(works)try{let wd=await fetchJSON('https://openlibrary.org'+works+'.json');desc=typeof wd.description==='string'?wd.description:(wd.description?.value||'')}catch(e){}
      return {isbn:x,title:d.title||'Unknown title',author:(d.authors||[]).map(a=>a.name||'').filter(Boolean).join(', '),cover:`https://covers.openlibrary.org/b/isbn/${x}-L.jpg`,publisher:(d.publishers||[])[0]||'',year:d.publish_date||'',description:desc};
    }catch(e){}
  }
  throw new Error('Book not found');
}
function showAddChoice(data,source='ISBN'){
  $('#scanMsg').textContent=`Found: ${data.title}`;
  let old=$('#addChoice');if(old)old.remove();
  let wrap=document.createElement('div');wrap.id='addChoice';wrap.className='manual';wrap.innerHTML=`<p><b>${esc(data.title)}</b><br>${esc(data.author||'Unknown author')}</p><div class="manualRow"><button class="smallPrimary" id="ownItBtn">Own It</button><button class="small" id="wantItBtn">Want to Buy</button></div>`;
  $('#scan').appendChild(wrap);
  $('#ownItBtn').onclick=()=>addBook(data,'Owned');
  $('#wantItBtn').onclick=()=>addBook(data,'Want to Buy');
}
function addBook(data,status){
  let ex=existingByISBN(data.isbn);if(ex){alert(ex.status==='Owned'?'Already in your library.':'This book is already on your Want to Buy list.');showDetails(ex.id);return}
  let b={id:crypto.randomUUID(),isbn:data.isbn,title:data.title||'Unknown title',author:data.author||'Unknown author',cover:data.cover||'',publisher:data.publisher||'',year:data.year||'',description:data.description||'',status,added:Date.now(),store:'',price:'',notes:''};
  books.unshift(b);save();let c=$('#addChoice');if(c)c.remove();stopCamera();showDetails(b.id);
}
async function lookup(isbn){
  isbn=cleanISBN(isbn);if(isbn.length!==10&&isbn.length!==13){alert('Please enter a valid ISBN-10 or ISBN-13.');return}
  let existing=existingByISBN(isbn);if(existing){await stopCamera();showDetails(existing.id);alert(existing.status==='Owned'?'You already have this book in your library.':'This book is already on your Want to Buy list.');return}
  $('#scanMsg').textContent='ISBN confirmed — looking up book…';
  try{let data=await lookupBookData(isbn);showAddChoice(data)}catch(e){$('#scanMsg').textContent='Book not found. Try another edition or enter the ISBN manually.';alert('I could not find that ISBN in Google Books or Open Library.')}
}
function resetCandidate(){candidateISBN='';candidateHits=0;candidateSince=0}
async function startCamera(){
  await stopCamera();nav('scan');scanLocked=false;resetCandidate();$('#scanMsg').textContent='Starting camera…';
  const oldVideo=$('#video');if(!oldVideo)return;oldVideo.style.display='none';const parent=oldVideo.parentElement;let prior=$('#zxing-video');if(prior)prior.remove();
  scanVideo=document.createElement('video');scanVideo.id='zxing-video';scanVideo.setAttribute('playsinline','true');scanVideo.setAttribute('autoplay','true');scanVideo.muted=true;scanVideo.style.cssText='display:block;width:100%;height:100%;min-height:260px;object-fit:cover;border-radius:12px;background:#111';parent.appendChild(scanVideo);
  try{
    const browserMod=await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm'),libMod=await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
    const hints=new Map();hints.set(libMod.DecodeHintType.POSSIBLE_FORMATS,[libMod.BarcodeFormat.EAN_13,libMod.BarcodeFormat.EAN_8]);hints.set(libMod.DecodeHintType.TRY_HARDER,true);
    zxingReader=new browserMod.BrowserMultiFormatReader(hints,120);
    scannerControls=await zxingReader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30},focusMode:'continuous'}},scanVideo,(result,error)=>{
      if(scanLocked||!result)return;let isbn=cleanISBN(result.getText());if(isbn.length!==13)return;let now=Date.now();
      if(isbn===candidateISBN&&now-candidateSince<2200)candidateHits++;else{candidateISBN=isbn;candidateHits=1;candidateSince=now}
      $('#scanMsg').textContent=`Barcode detected — confirming ISBN (${Math.min(candidateHits,2)}/2). Hold steady.`;
      if(candidateHits>=2){scanLocked=true;lookup(isbn)}
    });
    $('#scanMsg').textContent='Center the whole barcode in the camera view. Hold steady; avoid glare and shadows.';
  }catch(e){console.error(e);$('#scanMsg').textContent='Could not start the scanner. Check Safari camera permission, then refresh.';if(scanVideo){scanVideo.remove();scanVideo=null}oldVideo.style.display=''}
}
async function stopCamera(){
  if(scannerControls){try{scannerControls.stop()}catch(e){}scannerControls=null}
  if(zxingReader){try{zxingReader.reset()}catch(e){}zxingReader=null}
  if(scanVideo){try{scanVideo.pause();if(scanVideo.srcObject)scanVideo.srcObject.getTracks().forEach(t=>t.stop())}catch(e){}scanVideo.remove();scanVideo=null}
  let v=$('#video');if(v){v.srcObject=null;v.style.display=''}resetCandidate();scanLocked=false
}
function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=URL.createObjectURL(file);
  });
}
function canvasCropRotate(img,sx,sy,sw,sh,angle=0,scale=1.7){
  const rad=Math.abs(angle)*Math.PI/180;
  const rw=Math.ceil((Math.abs(Math.cos(rad))*sw+Math.abs(Math.sin(rad))*sh)*scale);
  const rh=Math.ceil((Math.abs(Math.sin(rad))*sw+Math.abs(Math.cos(rad))*sh)*scale);
  const c=document.createElement('canvas');c.width=rw;c.height=rh;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,rw,rh);
  ctx.save();ctx.translate(rw/2,rh/2);ctx.rotate(angle*Math.PI/180);ctx.scale(scale,scale);
  ctx.drawImage(img,sx,sy,sw,sh,-sw/2,-sh/2,sw,sh);ctx.restore();
  return c;
}
async function ocrCanvas(canvas,label,status){
  const {data:{text}}=await Tesseract.recognize(canvas,'eng',{
    logger:m=>{
      if(m.status==='recognizing text'){
        status.textContent=`Reading ${label}… ${Math.round((m.progress||0)*100)}%`;
      }
    }
  });
  return text;
}
function cleanOCRLine(line){
  return line.replace(/[|_~`]+/g,' ')
    .replace(/[^\p{L}\p{N}.'’&,:;!?()\- ]/gu,' ')
    .replace(/\s+/g,' ').trim();
}
function usefulOCRLines(text){
  return [...new Set(text.split(/\n+/).map(cleanOCRLine)
    .filter(x=>x.length>=3)
    .filter(x=>/[A-Za-z]/.test(x))
    .filter(x=>!/^(page|copyright|www|http|isbn|library|publisher|press)$/i.test(x)))];
}
async function identifyShelfText(lines,status){
  let candidates=[], seen=new Set();
  for(let raw of lines.slice(0,30)){
    let q=raw.replace(/\b(the|a|an)\b/gi,' ').replace(/\s+/g,' ').trim();
    if(q.length<3)continue;
    try{
      let g=await fetchJSON('https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent(q)+'&maxResults=5');
      let items=g.items||[];
      // Prefer a title that shares several meaningful words with the OCR text.
      let words=q.toLowerCase().split(/\s+/).filter(w=>w.length>2);
      let scored=items.map(item=>{
        let v=item.volumeInfo||{}, hay=((v.title||'')+' '+(v.subtitle||'')+' '+(v.authors||[]).join(' ')).toLowerCase();
        let score=words.reduce((n,w)=>n+(hay.includes(w)?1:0),0);
        return {item,score};
      }).sort((a,b)=>b.score-a.score)[0];
      if(scored?.item?.volumeInfo){
        let v=scored.item.volumeInfo;
        let isbn13=(v.industryIdentifiers||[]).find(i=>i.type==='ISBN_13')?.identifier||'';
        let isbn10=(v.industryIdentifiers||[]).find(i=>i.type==='ISBN_10')?.identifier||'';
        let key=cleanISBN(isbn13||isbn10)||((v.title||'')+'|'+(v.authors||[]).join(',')).toLowerCase();
        if(!seen.has(key)){
          seen.add(key);
          candidates.push({
            ocr:raw,isbn:isbn13||isbn10,title:v.title||raw,
            author:(v.authors||[]).join(', '),
            cover:v.imageLinks?.thumbnail?.replace('http:','https:')||'',
            publisher:v.publisher||'',year:v.publishedDate||'',
            description:v.description||'',matchScore:scored.score
          });
        }
      }
    }catch(e){}
  }
  return candidates.sort((a,b)=>b.matchScore-a.matchScore);
}
async function scanShelfFile(file){
  if(!file)return;
  const preview=$('#shelfPreview'),status=$('#shelfStatus'),results=$('#shelfResults');
  results.innerHTML='';
  preview.innerHTML='';
  status.textContent='Preparing shelf photo…';
  try{
    const img=await loadImageFromFile(file);
    preview.innerHTML=`<img src="${img.src}" alt="Shelf photo">`;
    let allText=[];
    // Full-image OCR after rotating the photo so vertical book-spine text becomes horizontal.
    const full90=canvasCropRotate(img,0,0,img.naturalWidth,img.naturalHeight,90,1.25);
    allText.push(await ocrCanvas(full90,'rotated shelf photo',status));
    // Also OCR overlapping vertical sections. This helps when several spines are close together.
    const w=img.naturalWidth,h=img.naturalHeight;
    const sections=Math.min(8,Math.max(4,Math.ceil(w/220)));
    const overlap=.12;
    for(let i=0;i<sections;i++){
      const sw=w/sections*(1+overlap);
      const sx=Math.max(0,Math.min(w-sw,(i*w/sections)-sw*overlap/2));
      const crop=canvasCropRotate(img,sx,0,sw,h,90,1.7);
      allText.push(await ocrCanvas(crop,`spine group ${i+1} of ${sections}`,status));
    }
    const lines=usefulOCRLines(allText.join('\n'));
    if(!lines.length){
      status.textContent='I could not read any book spines. Try moving closer and filling the photo with the books.';
      return;
    }
    // Show the OCR text so failures are diagnosable instead of silently returning nothing.
    const debug=document.createElement('details');
    debug.className='ocrDebug';
    debug.innerHTML=`<summary>Text detected (${lines.length})</summary><div>${lines.slice(0,20).map(esc).join('<br>')}</div>`;
    results.appendChild(debug);

    status.textContent=`I read ${lines.length} text lines. Searching for likely books…`;
    const candidates=await identifyShelfText(lines,status);
    if(!candidates.length){
      status.textContent='I could read text, but could not find confident book matches. Try a closer photo with the full spines visible.';
      return;
    }

    status.innerHTML=`Review ${candidates.length} possible book${candidates.length===1?'':'s'} before adding.`;
    const bar=document.createElement('div');
    bar.className='reviewBar';
    bar.innerHTML=`<span><b>${candidates.length}</b> possible books</span><button id="addSelectedShelf">Add Selected to Owned</button>`;
    results.appendChild(bar);

    candidates.forEach((c,i)=>{
      let ex=c.isbn?existingByISBN(c.isbn):books.find(b=>
        (b.title||'').toLowerCase()===(c.title||'').toLowerCase() &&
        (b.author||'').toLowerCase()===(c.author||'').toLowerCase()
      );
      let item=document.createElement('div');
      item.className='shelfItem';
      let confidence=c.matchScore>=3?'Good match':c.matchScore===2?'Possible match':'Review carefully';
      item.innerHTML=`${c.cover?`<img src="${esc(c.cover)}">`:`<div class="shelfItem img noCover">No cover</div>`}
        <div class="info">
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.author||'Unknown author')}</p>
          <div class="state">${esc(ex?(ex.status==='Owned'?'Already in your library':'Already on Want to Buy'):confidence)}</div>
          <div style="font-size:10px;color:#8a8f95;margin-top:4px">Read: ${esc(c.ocr)}</div>
        </div>
        <button class="addShelf" ${ex?'disabled':''}>Select</button>`;
      item.dataset.selected=ex?'0':'1';
      item.dataset.index=i;
      const btn=item.querySelector('.addShelf');
      if(!ex){
        btn.onclick=()=>{
          item.dataset.selected=item.dataset.selected==='1'?'0':'1';
          btn.textContent=item.dataset.selected==='1'?'Select':'Selected';
          btn.style.opacity=item.dataset.selected==='1'?'1':'.6';
        };
      }
      results.appendChild(item);
    });

    $('#addSelectedShelf').onclick=()=>{
      let added=0;
      candidates.forEach((c,i)=>{
        let el=results.querySelector(`.shelfItem[data-index="${i}"]`);
        if(!el||el.dataset.selected!=='1'||(c.isbn&&existingByISBN(c.isbn)))return;
        books.unshift({
          id:crypto.randomUUID(),isbn:c.isbn,title:c.title||'Unknown title',
          author:c.author||'Unknown author',cover:c.cover||'',
          publisher:c.publisher||'',year:c.year||'',description:c.description||'',
          status:'Owned',added:Date.now(),store:'',price:'',notes:''
        });
        added++;
      });
      save();renderAll();
      alert(added?`${added} book${added===1?'':'s'} added to Owned.`:'No new books were selected.');
      nav('library');
    };
  }catch(e){
    console.error('Shelf scan error:',e);
    status.textContent='Shelf scan failed. Try a closer, brighter photo with the book spines facing the camera.';
  }
}

$$('nav button').forEach(b=>b.onclick=()=>b.dataset.nav==='scan'?startCamera():nav(b.dataset.nav));
$('#scanHome').onclick=startCamera;$('#scanLib').onclick=startCamera;
$('#shelfHome').onclick=()=>nav('shelfScan');$('#shelfLib').onclick=()=>nav('shelfScan');
$('#closeScan').onclick=()=>nav('home');$('#closeShelf').onclick=()=>nav('home');$('#backDetails').onclick=()=>nav('library');$('#seeAll').onclick=()=>nav('library');
$('#search').oninput=renderLibrary;$('#lookupManual').onclick=()=>lookup($('#manualIsbn').value);$('#shelfPhoto').onchange=e=>scanShelfFile(e.target.files[0]);
$$('.chip').forEach(b=>b.onclick=()=>{$$('.chip').forEach(c=>c.classList.remove('active'));b.classList.add('active');currentFilter=b.dataset.filter;renderLibrary()});
$$('.stats button').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;nav('library')});
renderAll();
