'use strict';
const socket=io();
const screen=document.getElementById('teacher-screen');
const STORAGE='wordrush:host';
let state=null;
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n||0).toLocaleString('en-US');
const saved=()=>{try{return JSON.parse(localStorage.getItem(STORAGE))}catch{return null}};
const save=x=>localStorage.setItem(STORAGE,JSON.stringify(x));
async function loadQuizOptions(){
  try{const r=await fetch('/api/quizzes');if(!r.ok)throw Error('Server error');const quizzes=await r.json();const sel=document.getElementById('quiz-selector');if(sel)sel.innerHTML=quizzes.map(q=>`<option value="${html(q.id)}">${html(q.title)} · ${q.questions} questions</option>`).join('');}
  catch{const p=document.getElementById('teacher-error');if(p)p.textContent='Unable to load quiz packs. Reload the page.';}
}
function showLogin(){
  state=null;
  screen.innerHTML=`<section class="teacher-login-wrap"><form id="create-form" class="panel login-panel"><div class="eyebrow">YOUR CLASSROOM, YOUR GAME</div><h1>Let's play.</h1><p>Pick a vocabulary set and create a live room. Students join using the six-digit PIN.</p><label for="password">TEACHER PASSWORD</label><input id="password" type="password" placeholder="Teacher access password" autocomplete="current-password" required><label for="quiz-selector">VOCABULARY SET</label><select id="quiz-selector" required><option value="">Loading quizzes…</option></select><p id="teacher-error" class="error-message" role="alert"></p><button type="submit" class="primary-button" id="create-button">CREATE LIVE ROOM <span>→</span></button><div class="card-footnote">Only game controls — no quiz editor needed.</div></form></section>`;
  loadQuizOptions();
  document.getElementById('create-form').addEventListener('submit',e=>{
    e.preventDefault();const btn=document.getElementById('create-button');btn.disabled=true;
    const password=document.getElementById('password').value,quizId=document.getElementById('quiz-selector').value;
    socket.timeout(8000).emit('host:create',{password,quizId},(err,r)=>{
      btn.disabled=false;if(err||!r?.ok){document.getElementById('teacher-error').textContent=r?.message||'Could not create room.';return;}
      save({pin:r.pin,hostToken:r.hostToken});
    });
  });
}
function teacherNextLabel(){
  if(!state)return 'NEXT';
  if(state.status==='question')return 'REVEAL ANSWER →';
  if(state.status==='reveal')return state.questionIndex+1===state.totalQuestions?'SHOW PODIUM 🏆':'NEXT QUESTION →';
  if(state.status==='podium')return 'SHOW FULL RESULTS →';
  return 'NEXT →';
}
function makeRanking(items){return `<div class="ranking-list">${items.map(p=>`<div class="rank-row"><span class="rank-position">#${p.rank}</span><span class="rank-name">${html(p.name)}</span><span class="rank-score">${number(p.score)} pts</span></div>`).join('')}</div>`}
function render(){
  if(!state)return;
  const s=state,count=s.players.length,connected=s.players.filter(p=>p.connected).length;
  let quiz='',controls='';
  if(s.status==='lobby'){
    quiz=`<div class="teacher-cards"><div class="teacher-card"><div class="tiny-cap">STUDENTS IN LOBBY</div><div class="teacher-stat">${count}</div><p class="teacher-hint">${connected} online · new students appear automatically</p></div><div class="teacher-card"><div class="tiny-cap">JOIN ADDRESS</div><h3>${html(location.host)}</h3><p class="teacher-hint">Share the website and the six-digit PIN. Or copy the join link.</p><button class="secondary-button" id="copy-link">COPY STUDENT LINK ↗</button></div></div><div class="teacher-card"><h3>Who's here?</h3><div class="teacher-avatar-tags">${count?s.players.map(p=>`<span class="student-tag ${p.connected?'':'offline'}">${html(p.name)} ${p.connected?'✓':'· offline'}</span>`).join(''):'<p class="teacher-hint">Waiting for the first student to enter their PIN…</p>'}</div></div>`;
    controls=`<button class="primary-button" id="game-start" ${count?'':'disabled'}>START GAME <span>→</span></button>`;
  }else if(s.status==='question'||s.status==='reveal'){
    const q=s.question,done=s.status==='reveal';
    quiz=`<div class="teacher-cards"><div class="teacher-card"><div class="tiny-cap">QUESTION ${q.number} / ${q.total}</div><div class="teacher-stat" id="timer-seconds">${done?'0':'--'}s</div><div class="timer-bar"><div class="timer-fill" id="timer-fill" style="width:${done?0:100}%"></div></div></div><div class="teacher-card"><div class="tiny-cap">ANSWERS RECEIVED</div><div class="teacher-stat">${s.players.filter(p=>p.answered).length}<span style="font-size:22px;color:#a3abc5"> / ${count}</span></div><p class="teacher-hint">${connected} currently connected</p></div></div><div class="teacher-card"><div class="tiny-cap">${done?'CORRECT ANSWER REVEALED':'LIVE QUESTION'}</div><h2>${html(q.prompt)}</h2><div class="teacher-answers">${q.options.map((x,i)=>`<div class="answer-option-${i} ${done&&s.reveal.correct===i?'correct-choice':''}"><span>${['◆','▲','●','■'][i]} ${html(x)}</span><span>${done?s.reveal.counts[i]+' votes':''}</span></div>`).join('')}</div></div>`;
    controls=`<button class="primary-button" id="game-next">${teacherNextLabel()} <span>→</span></button>`;
  }else if(s.status==='podium'){
    quiz=`<div class="teacher-card" style="text-align:center"><div class="tiny-cap">🏆 TOP 3 STUDENTS</div><h2 style="font:800 45px 'Space Grotesk'">The Podium!</h2>${makeRanking(s.ranking)}</div>`;
    controls=`<button class="primary-button" id="game-next">SHOW FULL RESULTS <span>→</span></button>`;
  }else if(s.status==='leaderboard'){
    quiz=`<div class="teacher-card"><div class="tiny-cap">COMPLETE CLASS RANKING</div><h2 style="font:800 42px 'Space Grotesk'">Final Results</h2>${makeRanking(s.ranking)}</div>`;
    controls=`<button class="secondary-button" id="new-game">CREATE ANOTHER ROOM ↗</button>`;
  }
  screen.innerHTML=`<section class="game-screen"><div class="teacher-top"><div><div class="eyebrow">${s.status==='lobby'?'✦ READY WHEN YOU ARE':s.status==='leaderboard'?'✦ GAME COMPLETE':'✦ LIVE ROUND IN PROGRESS'}</div><h1>${html(s.title)}</h1><p class="teacher-hint">${html(s.subtitle||'')} · ${s.totalQuestions} questions</p></div><div class="teacher-game-pin"><small>GAME PIN</small><strong>${html(s.pin)}</strong></div></div>${quiz}<div class="teacher-controls">${controls}<span class="teacher-hint">${s.status==='lobby'?'Players are waiting for you to press Start.':s.status==='question'?'The timer ends automatically, or reveal early.':s.status==='reveal'?'Students see the right answer. Press Next to continue.':s.status==='podium'?'Press Next for every student’s rank.':'Finished. You can create a new room.'}</span></div></section>`;
  document.getElementById('copy-link')?.addEventListener('click',async()=>{
    const url=`${location.origin}/join/${s.pin}`;
    try{await navigator.clipboard.writeText(url);document.getElementById('copy-link').textContent='✓ LINK COPIED';}
    catch{prompt('Copy this student link:',url)}
  });
  document.getElementById('game-start')?.addEventListener('click',()=>action('host:start'));
  document.getElementById('game-next')?.addEventListener('click',()=>action('host:next'));
  document.getElementById('new-game')?.addEventListener('click',()=>{localStorage.removeItem(STORAGE);showLogin()});
  updateClock();
}
function action(event){
  const btn=document.getElementById('game-next')||document.getElementById('game-start');if(btn)btn.disabled=true;
  socket.timeout(6000).emit(event,{},(err,r)=>{
    if(err||!r?.ok){alert(r?.message||'Action failed. Please try again.');if(btn)btn.disabled=false;}
  });
}
function updateClock(){
  if(!state||state.status!=='question')return;
  const remain=Math.max(0,state.question.endsAt-Date.now());const txt=document.getElementById('timer-seconds'),bar=document.getElementById('timer-fill');
  if(txt)txt.textContent=Math.ceil(remain/1000)+'s';if(bar)bar.style.width=(100*remain/(state.question.duration*1000))+'%';
}
setInterval(updateClock,130);
socket.on('game:state',s=>{state=s;render()});
socket.on('connect',()=>{
  const session=saved();
  if(session?.pin&&session.hostToken){
    socket.timeout(7000).emit('host:resume',session,(err,r)=>{
      if(err){return;}if(!r?.ok){localStorage.removeItem(STORAGE);showLogin();}
    });
  }else if(!state)showLogin();
  document.getElementById('offline-banner')?.remove();
});
socket.on('disconnect',()=>{if(!document.getElementById('offline-banner')){const div=document.createElement('div');div.className='connection-banner';div.id='offline-banner';div.textContent='Connection lost. Reconnecting…';document.body.prepend(div);}});
if(!saved())showLogin();
