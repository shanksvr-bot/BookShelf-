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
async function scanShelfFile(file){
  if(!file)return;
  let preview=$('#shelfPreview'),status=$('#shelfStatus'),results=$('#shelfResults');results.innerHTML='';status.textContent='Loading shelf photo…';
  let url=URL.createObjectURL(file);preview.innerHTML=`<img src="${url}" alt="Shelf photo">`;
  try{
    status.textContent='Reading book spines… This can take a little while on an iPhone.';
    let {data:{text}}=await Tesseract.recognize(file,'eng',{logger:m=>{if(m.status==='recognizing text')status.textContent=`Reading book spines… ${Math.round((m.progress||0)*100)}%`;}});
    let lines=[...new Set(text.split(/\n+/).map(x=>x.replace(/[|_]+/g,' ').replace(/\s+/g,' ').trim()).filter(x=>x.length>=3))];
    if(!lines.length){status.textContent='I could not read any book titles. Try a closer, brighter photo.';return}
    status.textContent=`Found ${lines.length} text lines. Searching for likely books…`;
    let candidates=[];
    for(const line of lines.slice(0,18)){
      try{
        let g=await fetchJSON('https://www.googleapis.com/books/v1/volumes?q=intitle:'+encodeURIComponent(line)+'&maxResults=3');
        let items=g.items||[];
        let item=items.find(x=>x.volumeInfo?.title);
        if(item){let v=item.volumeInfo||{};candidates.push({ocr:line,isbn:(v.industryIdentifiers||[]).find(i=>i.type==='ISBN_13')?.identifier||(v.industryIdentifiers||[]).find(i=>i.type==='ISBN_10')?.identifier||'',title:v.title||line,author:(v.authors||[]).join(', '),cover:v.imageLinks?.thumbnail?.replace('http:','https:')||'',publisher:v.publisher||'',year:v.publishedDate||'',description:v.description||''})}
      }catch(e){}
    }
    // Deduplicate results by ISBN or title+author.
    let seen=new Set();candidates=candidates.filter(c=>{let k=cleanISBN(c.isbn)||((c.title||'')+'|'+(c.author||'')).toLowerCase();if(seen.has(k))return false;seen.add(k);return true});
    if(!candidates.length){status.textContent='I could not confidently identify books from that photo. Try one shelf at a time with the spines facing the camera.';return}
    status.innerHTML=`Review ${candidates.length} possible book${candidates.length===1?'':'s'} before adding.`;
    let bar=document.createElement('div');bar.className='reviewBar';bar.innerHTML=`<span><b>${candidates.length}</b> possible books</span><button id="addSelectedShelf">Add Selected to Owned</button>`;results.appendChild(bar);
    candidates.forEach((c,i)=>{
      let ex=c.isbn?existingByISBN(c.isbn):books.find(b=>(b.title||'').toLowerCase()===(c.title||'').toLowerCase()&&(b.author||'').toLowerCase()===(c.author||'').toLowerCase());
      let item=document.createElement('div');item.className='shelfItem';
      let state=ex?(ex.status==='Owned'?'Already in your library':'Already on Want to Buy'):'Ready to add';
      item.innerHTML=`${c.cover?`<img src="${esc(c.cover)}">`:`<div class="shelfItem img noCover">No cover</div>`}<div class="info"><h3>${esc(c.title)}</h3><p>${esc(c.author||'Unknown author')}</p><div class="state">${esc(state)}</div></div><button class="addShelf" ${ex?'disabled':''}>Select</button>`;
      item.dataset.selected=ex?'0':'1';item.dataset.index=i;
      let btn=item.querySelector('.addShelf');if(!ex)btn.onclick=()=>{item.dataset.selected=item.dataset.selected==='1'?'0':'1';btn.textContent=item.dataset.selected==='1'?'Select':'Selected';btn.style.opacity=item.dataset.selected==='1'?'1':'.6'};
      results.appendChild(item);
    });
    $('#addSelectedShelf').onclick=()=>{
      let added=0;
      candidates.forEach((c,i)=>{let el=results.querySelector(`.shelfItem[data-index="${i}"]`);if(!el||el.dataset.selected!=='1'||(c.isbn&&existingByISBN(c.isbn)))return;books.unshift({id:crypto.randomUUID(),isbn:c.isbn,title:c.title||'Unknown title',author:c.author||'Unknown author',cover:c.cover||'',publisher:c.publisher||'',year:c.year||'',description:c.description||'',status:'Owned',added:Date.now(),store:'',price:'',notes:''});added++});
      save();renderAll();alert(added?`${added} book${added===1?'':'s'} added to Owned.`:'No new books were selected.');nav('library');
    };
  }catch(e){console.error(e);status.textContent='Shelf scan failed. Try a clearer photo with the book spines facing the camera.'}
}
$$('nav button').forEach(b=>b.onclick=()=>b.dataset.nav==='scan'?startCamera():nav(b.dataset.nav));
$('#scanHome').onclick=startCamera;$('#scanLib').onclick=startCamera;
$('#shelfHome').onclick=()=>nav('shelfScan');$('#shelfLib').onclick=()=>nav('shelfScan');
$('#closeScan').onclick=()=>nav('home');$('#closeShelf').onclick=()=>nav('home');$('#backDetails').onclick=()=>nav('library');$('#seeAll').onclick=()=>nav('library');
$('#search').oninput=renderLibrary;$('#lookupManual').onclick=()=>lookup($('#manualIsbn').value);$('#shelfPhoto').onchange=e=>scanShelfFile(e.target.files[0]);
$$('.chip').forEach(b=>b.onclick=()=>{$$('.chip').forEach(c=>c.classList.remove('active'));b.classList.add('active');currentFilter=b.dataset.filter;renderLibrary()});
$$('.stats button').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;nav('library')});
renderAll();
