const KEY='bookshelf_books_v1';
let books=JSON.parse(localStorage.getItem(KEY)||'[]');
let currentFilter='all';
let scannerControls=null;
let zxingReader=null;
let scanLocked=false;
let candidateISBN='';
let candidateHits=0;
let candidateSince=0;
let scanVideo=null;

const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);

function save(){localStorage.setItem(KEY,JSON.stringify(books))}
function nav(id){
  $$('.screen').forEach(x=>x.classList.remove('active'));
  $('#'+id).classList.add('active');
  $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.nav===id));
  if(id!=='scan')stopCamera();
  renderAll();
}
function esc(s=''){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function counts(){
  let o=books.filter(b=>b.status==='Owned').length;
  let w=books.filter(b=>b.status==='Want to Buy').length;
  let r=books.filter(b=>b.status==='Read').length;
  $('#bookCount').textContent=books.length;
  $('#ownedCount').textContent=o;
  $('#wantCount').textContent=w;
  $('#readCount').textContent=r;
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
  let q=($('#search')?.value||'').toLowerCase();
  let map={owned:'Owned',want:'Want to Buy',read:'Read'};
  let arr=books.filter(b=>currentFilter==='all'||b.status===map[currentFilter]).filter(b=>(b.title+' '+b.author+' '+b.isbn).toLowerCase().includes(q));
  $('#libraryList').innerHTML=arr.length?arr.map(card).join(''):`<div class="empty"><b>No matching books</b><span>Try another search or scan a book.</span></div>`;
}
function showDetails(id){
  let b=books.find(x=>x.id===id);if(!b)return;
  $('#detailsContent').innerHTML=`<div class="detailHero">${b.cover?`<img class="detailCover" src="${esc(b.cover)}">`:`<div class="detailCover noCover">No cover</div>`}<div class="detailMeta"><h2>${esc(b.title)}</h2><p><b>${esc(b.author||'Unknown author')}</b></p><p>ISBN: ${esc(b.isbn)}</p><p>${esc(b.publisher||'')} ${b.year?'• '+esc(b.year):''}</p></div></div><div class="detailActions"><button class="action primaryAction" onclick="cycleStatus('${b.id}')">${esc(b.status)}</button><button class="action" onclick="removeBook('${b.id}')">Delete</button></div><div class="description">${esc(b.description||'No description available.')}</div><div class="field"><label>Where I bought it</label><input id="storeField" value="${esc(b.store||'')}" placeholder="Bookstore, thrift store, etc."></div><div class="field"><label>Price paid</label><input id="priceField" inputmode="decimal" value="${esc(b.price||'')}" placeholder="$0.00"></div><div class="field"><label>Personal notes</label><textarea id="notesField" rows="4" placeholder="Notes about this book...">${esc(b.notes||'')}</textarea></div><button class="primary big" style="margin-top:14px" onclick="saveDetails('${b.id}')">Save Changes</button>`;
  nav('details');
}
function saveDetails(id){
  let b=books.find(x=>x.id===id);
  b.store=$('#storeField').value;b.price=$('#priceField').value;b.notes=$('#notesField').value;
  save();alert('Book updated.');showDetails(id);
}
function cycleStatus(id){
  let b=books.find(x=>x.id===id),s=['Owned','Want to Buy','Reading','Read'];
  b.status=s[(s.indexOf(b.status)+1)%s.length];save();showDetails(id);
}
function removeBook(id){
  if(confirm('Remove this book from your library?')){books=books.filter(x=>x.id!==id);save();nav('library');}
}
function cleanISBN(value){return String(value||'').replace(/[^0-9Xx]/g,'').toUpperCase();}
async function lookup(isbn){
  isbn=cleanISBN(isbn);
  if(isbn.length!==10&&isbn.length!==13){alert('Please enter a valid ISBN-10 or ISBN-13.');return;}
  let existing=books.find(b=>cleanISBN(b.isbn)===isbn);
  if(existing){await stopCamera();showDetails(existing.id);alert('You already have this book in your library.');return;}
  $('#scanMsg').textContent='ISBN confirmed — looking up book…';
  try{
    let r=await fetch('https://openlibrary.org/isbn/'+encodeURIComponent(isbn)+'.json');
    if(!r.ok)throw new Error('Book not found');
    let d=await r.json(),desc='',works=d.works?.[0]?.key;
    if(works)try{
      let wd=await(await fetch('https://openlibrary.org'+works+'.json')).json();
      desc=typeof wd.description==='string'?wd.description:(wd.description?.value||'');
    }catch(e){}
    let b={id:crypto.randomUUID(),isbn,title:d.title||'Unknown title',author:(d.authors||[]).map(a=>a.name||'').filter(Boolean).join(', '),cover:`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,publisher:(d.publishers||[])[0]||'',year:d.publish_date||'',description:desc,status:'Owned',added:Date.now(),store:'',price:'',notes:''};
    books.unshift(b);save();await stopCamera();showDetails(b.id);
  }catch(e){
    $('#scanMsg').textContent='Book not found. Try another angle or enter the ISBN manually.';
    alert('I could not find that ISBN. Try the manual ISBN field or another edition.');
  }
}
function resetCandidate(){candidateISBN='';candidateHits=0;candidateSince=0;}
async function startCamera(){
  await stopCamera();
  nav('scan');
  scanLocked=false;resetCandidate();
  $('#scanMsg').textContent='Starting camera…';
  const oldVideo=$('#video');
  if(!oldVideo){$('#scanMsg').textContent='Scanner video area was not found. Please refresh the app.';return;}
  oldVideo.style.display='none';
  const parent=oldVideo.parentElement;
  let prior=$('#zxing-video');if(prior)prior.remove();
  scanVideo=document.createElement('video');
  scanVideo.id='zxing-video';
  scanVideo.setAttribute('playsinline','true');
  scanVideo.setAttribute('autoplay','true');
  scanVideo.muted=true;
  scanVideo.style.cssText='display:block;width:100%;height:100%;min-height:260px;object-fit:cover;border-radius:12px;background:#111';
  parent.appendChild(scanVideo);
  try{
    $('#scanMsg').textContent='Loading barcode reader…';
    const browserMod=await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
    const libMod=await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm');
    const hints=new Map();
    hints.set(libMod.DecodeHintType.POSSIBLE_FORMATS,[libMod.BarcodeFormat.EAN_13,libMod.BarcodeFormat.EAN_8]);
    hints.set(libMod.DecodeHintType.TRY_HARDER,true);
    zxingReader=new browserMod.BrowserMultiFormatReader(hints,120);
    const constraints={
      audio:false,
      video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1920},
        height:{ideal:1080},
        frameRate:{ideal:30,max:30},
        focusMode:'continuous'
      }
    };
    scannerControls=await zxingReader.decodeFromConstraints(constraints,scanVideo,(result,error)=>{
      if(scanLocked||!result)return;
      const raw=result.getText();
      const isbn=cleanISBN(raw);
      if(isbn.length!==13)return;
      const now=Date.now();
      if(isbn===candidateISBN && now-candidateSince<2200)candidateHits++;
      else{candidateISBN=isbn;candidateHits=1;candidateSince=now;}
      $('#scanMsg').textContent=`Barcode detected — confirming ISBN (${Math.min(candidateHits,2)}/2). Hold steady.`;
      if(candidateHits>=2){
        scanLocked=true;
        $('#scanMsg').textContent='ISBN confirmed. Looking up book…';
        lookup(isbn);
      }
    });
    $('#scanMsg').textContent='Center the whole barcode in the camera view. Hold steady; avoid glare and shadows.';
  }catch(e){
    console.error('ZXing camera error:',e);
    $('#scanMsg').textContent='Could not start the scanner. Check Safari camera permission, then refresh. You can enter the ISBN manually below.';
    if(scanVideo){scanVideo.remove();scanVideo=null;}
    oldVideo.style.display='';
  }
}
async function stopCamera(){
  if(scannerControls){try{scannerControls.stop();}catch(e){}scannerControls=null;}
  if(zxingReader){try{zxingReader.reset();}catch(e){}zxingReader=null;}
  if(scanVideo){
    try{scanVideo.pause();if(scanVideo.srcObject)scanVideo.srcObject.getTracks().forEach(t=>t.stop());}catch(e){}
    scanVideo.remove();scanVideo=null;
  }
  const oldVideo=$('#video');if(oldVideo){oldVideo.srcObject=null;oldVideo.style.display='';}
  resetCandidate();scanLocked=false;
}
$$('nav button').forEach(b=>b.onclick=()=>b.dataset.nav==='scan'?startCamera():nav(b.dataset.nav));
$('#scanHome').onclick=startCamera;
$('#scanLib').onclick=startCamera;
$('#closeScan').onclick=()=>nav('home');
$('#backDetails').onclick=()=>nav('library');
$('#seeAll').onclick=()=>nav('library');
$('#search').oninput=renderLibrary;
$('#lookupManual').onclick=()=>lookup($('#manualIsbn').value);
$$('.chip').forEach(b=>b.onclick=()=>{
  $$('.chip').forEach(c=>c.classList.remove('active'));
  b.classList.add('active');currentFilter=b.dataset.filter;renderLibrary();
});
$$('.stats button').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;nav('library');});
renderAll();
