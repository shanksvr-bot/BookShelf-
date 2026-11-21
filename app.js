const SUPABASE_URL='https://msyzkbeqmifdxoztsymd.supabase.co';
const SUPABASE_ANON_KEY='sb_publishable_7_5SW6vnp7CfY4FBahMtvA_Ku44atcG';
const supabaseClient=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

// LIVE SYNC BETWEEN DEVICES
let booksChannel = null;
let realtimeRefreshTimer = null;

async function startRealtimeSync(user) {
  if (booksChannel) {
    await supabaseClient.removeChannel(booksChannel);
    booksChannel = null;
  }

  booksChannel = supabaseClient
    .channel('books-live-sync')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'books',
        filter: `user_id=eq.${user.id}`
      },
      () => {
        clearTimeout(realtimeRefreshTimer);

        realtimeRefreshTimer = setTimeout(async () => {
          const { data, error } = await supabaseClient
            .from('books')
            .select('*')
            .eq('user_id', user.id);

          if (error) {
            console.error('Live sync error:', error);
            return;
          }

          books = data.map(book => ({
            id: book.local_id || book.id,
            cloudId: book.id,
            isbn: book.isbn,
            title: book.title,
            author: book.author,
            cover: book.cover,
            publisher: book.publisher,
            year: book.year,
            description: book.description,
            status: book.status,
            added: book.added,
            store: book.store,
            price: book.price,
            notes: book.notes
          }));

          localStorage.setItem(KEY, JSON.stringify(books));
          renderAll();

          console.log('Live library sync complete');
        }, 300);
      }
    )
    .subscribe((status) => {
      console.log('Live sync status:', status);
    });
}

let KEY='bookshelf_books_v1';
let books=[];
let currentFilter='all';
let scannerControls=null,zxingReader=null,scanLocked=false,candidateISBN='',candidateHits=0,candidateSince=0,scanVideo=null;
let shelfCandidates=[], shelfWorker=null;

const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
let cloudSaveTimer;

async function save(){
  localStorage.setItem(KEY, JSON.stringify(books));

  clearTimeout(cloudSaveTimer);

  cloudSaveTimer = setTimeout(async () => {
    try {
      const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();

      if (sessionError) throw sessionError;

      const user = sessionData.session?.user;
      if (!user) return;

      const { data: remoteBooks, error: fetchError } =
        await supabaseClient
          .from('books')
          .select('*')
          .eq('user_id', user.id);

      if (fetchError) throw fetchError;

      const usedIds = new Set();

      const cloudBooks = books.map(book => {
        if (!book.cloudId) {
          const isbn = String(book.isbn || '').trim();

          let match = isbn
            ? remoteBooks.find(row =>
                row.isbn &&
                row.isbn.trim() === isbn &&
                !usedIds.has(row.id)
              )
            : null;

          if (!match) {
            const title = String(book.title || '').trim().toLowerCase();
            const author = String(book.author || '').trim().toLowerCase();

            match = remoteBooks.find(row =>
              !usedIds.has(row.id) &&
              String(row.title || '').trim().toLowerCase() === title &&
              String(row.author || '').trim().toLowerCase() === author
            );
          }

          book.cloudId = match ? match.id : crypto.randomUUID();
        }

        usedIds.add(book.cloudId);

        return {
          id: book.cloudId,
          local_id: String(book.id),
          user_id: user.id,
          isbn: book.isbn || null,
          title: book.title || 'Untitled',
          author: book.author || null,
          cover: book.cover || null,
          publisher: book.publisher || null,
          year: book.year ? String(book.year) : null,
          description: book.description || null,
          status: book.status || 'Owned',
          added: book.added || Date.now(),
          store: book.store || null,
          price: book.price || null,
          notes: book.notes || null
        };
      });
  const matchedCount = cloudBooks.filter(row =>
        remoteBooks.some(remote => remote.id === row.id)
      ).length;

      if (remoteBooks.length > 0 && matchedCount !== books.length) {
        throw new Error(
          'Only ' + matchedCount + ' of ' + books.length +
          ' books matched. No cloud changes were made.'
        );
      }

      localStorage.setItem(KEY, JSON.stringify(books));

      if (cloudBooks.length) {
        const { error } = await supabaseClient
          .from('books')
          .upsert(cloudBooks, { onConflict: 'id' });

        if (error) throw error;
      }


    } catch (error) {
      console.error('Cloud save failed:', error);
    }
  }, 800);
}

 
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
  let cover = b.cover || '';

  if (cover) {
    return `<article class="book" onclick="showDetails('${b.id}')">
      <img class="cover"
           src="${esc(cover)}"
           alt="${esc(b.title)} cover"
           onerror="this.onerror=null; this.src='https://covers.openlibrary.org/b/isbn/${esc(normalizeISBN(b.isbn || ''))}-L.jpg';">
      <div class="bookInfo">
        <div class="bookTitle">${esc(b.title)}</div>
        <div class="author">${esc(b.author||'Unknown author')}</div>
        <span class="badge">${esc(b.status||'Owned')}</span>
      </div>
    </article>`;
  }

  return `<article class="book" onclick="showDetails('${b.id}')">
    <div class="cover noCover">No cover image</div>
    <div class="bookInfo">
      <div class="bookTitle">${esc(b.title)}</div>
      <div class="author">${esc(b.author||'Unknown author')}</div>
      <span class="badge">${esc(b.status||'Owned')}</span>
    </div>
  </article>`;
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
async function removeBook(id) {
  if (!confirm('Remove this book from your library?')) return;

  const book = books.find(x => x.id === id);
  if (!book) return;

  try {
    if (book.cloudId) {
      const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();

      if (sessionError) throw sessionError;

      const user = sessionData.session?.user;
      if (!user) throw new Error('You must be signed in to delete this book.');

      const { error } = await supabaseClient
        .from('books')
        .delete()
        .eq('id', book.cloudId)
        .eq('user_id', user.id);

      if (error) throw error;
    }

    books = books.filter(x => x.id !== id);
    save();
    nav('library');

  } catch (error) {
    console.error('Book deletion failed:', error);
    alert('Could not delete this book. Please try again.');
  }
}
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
  return {isbn:normalizeISBN(isbn),title:v.title||'',author:(v.authors||[]).join(', '),cover:(v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||'').replace(/^http:/,'https:')||v.imageLinks?.smallThumbnail||'',publisher:v.publisher||'',year:v.publishedDate||'',description:v.description||'',ocr};
}
async function lookup(isbn,statusChoice='Owned'){
  isbn=cleanISBN(isbn);

  if(isbn.length!==10&&isbn.length!==13){
    alert('Please enter a valid ISBN-10 or ISBN-13.');
    return;
  }

  let normalized=normalizeISBN(isbn);
  let existing=isDuplicate(normalized,'','');

  if(existing){
    await stopCamera();
    showDetails(existing.id);
    alert(existing.status==='Owned'
      ?'You already have this book in your library.'
      :'This book is already on your Want to Buy list.');
    return;
  }

  $('#scanMsg').textContent='ISBN confirmed — looking up book…';

  try{
    let item=null;

    // Try Google Books first
    try{
      let results=await googleBooks('isbn:'+normalized);
      item=results[0]||null;
    }catch(googleError){
      console.warn('Google Books unavailable. Trying Open Library.',googleError);
    }

    let b;

    // Use Open Library if Google Books did not return a book
    if(!item){
      let r=await fetch(
        'https://openlibrary.org/isbn/'+encodeURIComponent(normalized)+'.json'
      );

      if(!r.ok)throw new Error('Book not found');

      let d=await r.json();
      let desc='';
      let works=d.works?.[0]?.key;

      if(works){
        try{
          let wd=await(await fetch('https://openlibrary.org'+works+'.json')).json();
          desc=typeof wd.description==='string'
            ?wd.description
            :(wd.description?.value||'');
        }catch(e){}
      }

      b={
        id:crypto.randomUUID(),
        isbn:normalized,
        title:d.title||'Unknown title',
        author:(d.authors||[]).map(a=>a.name||'').filter(Boolean).join(','),
        cover:`https://covers.openlibrary.org/b/isbn/${normalized}-L.jpg`,
        publisher:(d.publishers||[])[0]||'',
        year:d.publish_date||'',
        description:desc,
        status:statusChoice,
        added:Date.now(),
        store:'',
        price:'',
        notes:''
      };

    }else{
      b=gbToBook(item);
      b.id=crypto.randomUUID();
      b.status=statusChoice;
      b.added=Date.now();
      b.store='';
      b.price='';
      b.notes='';
    }

    // Upload the cover to Supabase Storage
    if(b.cover){
      $('#scanMsg').textContent='Saving book cover to your library…';

      try{
        const {data,error}=await supabaseClient.functions.invoke(
          'import-book-cover',
          {
            body:{
              coverUrl:b.cover
            }
          }
        );

        if(error)throw error;

        if(!data?.success||!data.cover){
          throw new Error(data?.error||'Cover upload failed');
        }

        b.cover=data.cover;

        console.log('Book cover saved to Supabase:',b.cover);

      }catch(coverError){
        console.error('Could not upload book cover:',coverError);
      }
    }

    books.unshift(b);
    save();

    await stopCamera();
    showDetails(b.id);

  }catch(e){
    console.error('Book lookup failed:',e);
    $('#scanMsg').textContent='Book not found. Try another angle or enter the ISBN manually.';
    alert('I could not find that ISBN. Try the manual ISBN field or another edition.');
  }
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

async function shelfProcess(file) {
  $('#shelfWork').classList.remove('hidden');
  $('#shelfResults').innerHTML = '';
  $('#ocrDebug').classList.add('hidden');
  shelfCandidates = [];

  try {
    setShelfStatus('Preparing shelf photo…', 10);

    const im = await imageFromFile(file);
    const base = canvasFromImage(im, 1500);
    const imageData = base.toDataURL('image/jpeg', 0.85);

    $('#shelfPreview').src = imageData;

    setShelfStatus('AI is examining your bookshelf…', 30);

    const response = await fetch(
      'https://bookshelf-ai.shanksvr.workers.dev',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: imageData,
          mimeType: 'image/jpeg'
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.details || result.error || 'AI recognition failed'
      );
    }

    if (!result.success || !Array.isArray(result.books)) {
      throw new Error('Unexpected response from AI service.');
    }

    const books = result.books;
    let debug = [];

    setShelfStatus(
      `AI identified ${books.length} possible books. Checking book database…`,
      60
    );

    for (let i = 0; i < books.length; i++) {
      const book = books[i];

      const title = (book.title || '').trim();
      const author = (book.author || '').trim();

      if (!title) continue;

      const raw = book.evidence ||
        `${title}${author ? ' — ' + author : ''}`;

      debug.push(
        `Book ${i + 1}: ${title} — ${author} (AI confidence: ${book.confidence}%)`
      );

      setShelfStatus(
        `Looking up ${i + 1} of ${books.length}: ${title}…`,
        60 + ((i + 1) / Math.max(books.length, 1)) * 35
      );

      const matches = await searchShelfText(
        `${title} ${author}`
      );

      if (matches.length) {
        const best = matches[0];

        const score = scoreText(
          `${title} ${author}`,
          `${best.title} ${best.author}`
        );

        const existing = isDuplicate(
          best.isbn || book.isbn,
          best.title,
          best.author
        );

        shelfCandidates.push({
          ...best,
          raw,
          score,
          aiConfidence: book.confidence,
          existing,
          selected: !existing ||
            existing.status === 'Want to Buy'
        });

      } else {
        shelfCandidates.push({
          title,
          author,
          isbn: book.isbn || '',
          cover: '',
          raw,
          score: 0,
          aiConfidence: book.confidence,
          selected: false,
          needsSearch: true
        });
      }
    }

    setShelfStatus(
      `Done — ${shelfCandidates.length} possible books identified.`,
      100
    );

    $('#ocrDebug').innerHTML =
      `<div class="debugBox">
        <details>
          <summary>Show AI recognition results</summary>
          <div class="debugText">${esc(debug.join('\n'))}</div>
        </details>
      </div>`;

    $('#ocrDebug').classList.remove('hidden');

    renderShelfResults();

  } catch (e) {
    console.error(e);

    setShelfStatus('Shelf scan could not complete.', 0);

    $('#shelfResults').innerHTML =
      `<div class="empty">
        <b>Could not scan this photo</b>
        <span>${esc(e.message || 'Please try again.')}</span>
      </div>`;
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
  const selected = shelfCandidates.filter(b => b.selected === true);

  let added = 0;
  let moved = 0;
  let skipped = 0;

  selected.forEach(b => {
    if (!b.title || !String(b.title).trim()) {
      skipped++;
      return;
    }

    const existing = isDuplicate(
      b.isbn || '',
      b.title || '',
      b.author || ''
    );

    if (existing) {
      if (existing.status === 'Want to Buy') {
        existing.status = 'Owned';
        existing.added = Date.now();
        moved++;
      } else if (existing.status === 'Owned') {
        skipped++;
      } else {
        existing.status = 'Owned';
        existing.added = Date.now();
        moved++;
      }
      return;
    }

    const newBook = {
      id: crypto.randomUUID(),
      isbn: normalizeISBN(b.isbn || ''),
      title: String(b.title || '').trim(),
      author: String(b.author || 'Unknown author').trim(),
      cover: b.cover || '',
      publisher: b.publisher || '',
      year: b.year || '',
      description: b.description || '',
      status: 'Owned',
      added: Date.now(),
      store: '',
      price: '',
      notes: b.raw
        ? `Added from Shelf Scan. Scan text: ${b.raw}`
        : ''
    };

    books.unshift(newBook);
    added++;
  });

  save();

  alert(
    `${added} book${added === 1 ? '' : 's'} added to Owned.` +
    `${moved ? ` ${moved} existing book${moved === 1 ? '' : 's'} moved to Owned.` : ''}` +
    `${skipped ? ` ${skipped} skipped.` : ''}`
  );

  nav('library');
}

/* ---------- Supabase account login ---------- */
function showAuthStatus(message, isError=false) {
  const status = document.querySelector('#authStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? '#a33' : '#68727a';
}

async function showAppAfterLogin() {
  try {
    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();

    if (sessionError) throw sessionError;

    const user = sessionData.session?.user;
    if (!user) return;
    KEY = `bookshelf_books_${user.id}`;
$('#accountEmail').textContent = user.email || 'Email unavailable';
    books = [];

    const { data: cloudBooks, error } = await supabaseClient
      .from('books')
      .select('*')
      .eq('user_id', user.id);

    if (error) throw error;

    books = cloudBooks.map(book => ({
      id: book.local_id || book.id,
      cloudId: book.id,
      isbn: book.isbn,
      title: book.title,
      author: book.author,
      cover: book.cover,
      publisher: book.publisher,
      year: book.year,
      description: book.description,
      status: book.status,
      added: book.added,
      store: book.store,
      price: book.price,
      notes: book.notes
    }));

    localStorage.setItem(KEY, JSON.stringify(books));
    startRealtimeSync(user);
    document.body.classList.remove('auth-locked');
    document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
    $('#home').classList.add('active');
    $$('nav button').forEach(x =>
      x.classList.toggle('active', x.dataset.nav === 'home')
    );

    renderAll();

  } catch (error) {
    console.error('Cloud library download failed:', error);
    alert('Could not load your cloud library. Please try again.');
  }
}


function showLoginScreen() {
  document.body.classList.add('auth-locked');
  document.querySelectorAll('.screen').forEach(x => x.classList.remove('active'));
  $('#auth').classList.add('active');
}

async function signIn() {
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;

  if (!email || !password) {
    showAuthStatus('Enter your email and password.', true);
    return;
  }

  $('#signInBtn').disabled = true;
  showAuthStatus('Signing in…');

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showAppAfterLogin();
    showAuthStatus('');
  } catch (error) {
    showAuthStatus(error.message || 'Could not sign in.', true);
  } finally {
    $('#signInBtn').disabled = false;
  }
}

async function createAccount() {
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;

  if (!email || !password) {
    showAuthStatus('Enter your email and password to create your account.', true);
    return;
  }

  if (password.length < 6) {
    showAuthStatus('Use a password with at least 6 characters.', true);
    return;
  }

  $('#createAccountBtn').disabled = true;
  showAuthStatus('Creating your account…');

  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;

    if (data.session) {
      showAppAfterLogin();
      showAuthStatus('');
    } else {
      showAuthStatus('Account created. Check your email for the confirmation link, then return here and sign in.');
    }
  } catch (error) {
    showAuthStatus(error.message || 'Could not create your account.', true);
  } finally {
    $('#createAccountBtn').disabled = false;
  }
}

$('#signInBtn').onclick = signIn;
$('#createAccountBtn').onclick = createAccount;
$('#signOutBtn').onclick = async () => {
  if (!confirm('Are you sure you want to sign out?')) return;

  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert('Could not sign out: ' + error.message);
  }
};

$('#authPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') signIn();
});

document.body.classList.add('auth-locked');
showLoginScreen();

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (session) showAppAfterLogin();
  else if (event === 'SIGNED_OUT') showLoginScreen();
});

supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) {
    showAuthStatus(error.message, true);
    return;
  }
  if (data.session) showAppAfterLogin();
  else showLoginScreen();
});
/* events */
$$('nav button').forEach(b=>b.onclick=()=>b.dataset.nav==='scan'?startCamera():nav(b.dataset.nav));
$('#scanHome').onclick=startCamera;$('#scanLib').onclick=startCamera;
$('#shelfHome').onclick=()=>nav('shelf');$('#shelfLib').onclick=()=>nav('shelf');
$('#closeScan').onclick=()=>nav('home');$('#closeShelf').onclick=()=>nav('home');
$('#backDetails').onclick=()=>nav('library');$('#seeAll').onclick=()=>nav('library');
$('#search').oninput=renderLibrary;
$('#lookupManual').onclick=()=>lookup($('#manualIsbn').value);

$('#chooseShelf').onclick=()=>$('#shelfCamera').click();
$('#uploadShelf').onclick=()=>$('#shelfFile').click();

$('#shelfCamera').onchange=e=>{
  if(e.target.files[0]) shelfProcess(e.target.files[0]);
  e.target.value='';
};

$('#shelfFile').onchange=e=>{
  if(e.target.files[0]) shelfProcess(e.target.files[0]);
  e.target.value='';
};$$('.chip').forEach(b=>b.onclick=()=>{$$('.chip').forEach(c=>c.classList.remove('active'));b.classList.add('active');currentFilter=b.dataset.filter;renderLibrary()});
$$('.stats button').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;nav('library')});
renderAll();


async function recoverMissingCovers() {
  console.log('Starting Supabase cover migration...');

  const { data: sessionData } =
    await supabaseClient.auth.getSession();

  const user = sessionData.session?.user;

  if (!user) {
    console.error('You must be logged in.');
    return;
  }

  const { data: allBooks, error } = await supabaseClient
    .from('books')
    .select('id, title, author, cover')
    .eq('user_id', user.id);

  if (error) {
    console.error('Could not load books:', error);
    return;
  }

 // Process every book that needs a cover migration.
const booksToProcess = allBooks.filter(book =>
  !book.cover || book.cover.includes('openlibrary.org')
);

  console.log('Books to migrate:', booksToProcess.length);

  let updated = 0;

  for (const book of booksToProcess) {
    try {
      let coverUrl = book.cover;

      if (!coverUrl) {
        const searchUrl =
          'https://openlibrary.org/search.json?title=' +
          encodeURIComponent(book.title) +
          '&author=' +
          encodeURIComponent(book.author || '') +
          '&limit=5';

        const response = await fetch(searchUrl);

        if (!response.ok) {
          console.log('Search failed:', book.title);
          continue;
        }

        const results = await response.json();
        const match = results.docs?.find(item => item.cover_i);

        if (!match) {
          console.log('No cover found:', book.title);
          continue;
        }

        coverUrl =
          `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`;
      }

      const { data, error: uploadError } =
        await supabaseClient.functions.invoke(
          'import-book-cover',
          {
            body: { coverUrl }
          }
        );

      if (uploadError || !data?.success) {
        console.error(
          'Image upload failed:',
          book.title,
          uploadError || data?.error
        );
        continue;
      }

      const { error: updateError } = await supabaseClient
        .from('books')
        .update({ cover: data.cover })
        .eq('id', book.id)
        .eq('user_id', user.id);

      if (updateError) {
        console.error('Database update failed:', updateError);
        continue;
      }

      updated++;
      console.log('Supabase cover saved:', book.title);

    } catch (err) {
      console.error('Migration failed:', book.title, err);
    }
  }

  console.log(`Migration finished. Updated ${updated} books.`);
}

window.recoverMissingCovers = recoverMissingCovers;

