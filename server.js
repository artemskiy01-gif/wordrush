'use strict';
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 20_000 });
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.TEACHER_PASSWORD || crypto.randomBytes(12).toString('base64url');
if (!process.env.TEACHER_PASSWORD) {
  console.log('\n\u26a0\ufe0f  No TEACHER_PASSWORD secret set. Temporary teacher password: ' + ADMIN_PASSWORD);
  console.log('Set TEACHER_PASSWORD in your hosting Secrets before sharing the site.\n');
}
const games = new Map();
const makeToken = () => crypto.randomBytes(24).toString('hex');
const roomName = pin => `game:${pin}`;
const textTrim = (str, max) => typeof str === 'string' ? str.trim().slice(0, max) : '';
const fail = (ack, message) => typeof ack === 'function' && ack({ ok: false, message });
const ok = (ack, data={}) => typeof ack === 'function' && ack({ok: true, ...data});
const secureEqual = (a,b) => {
  const ab = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};
function loadQuizzes(){
  const folder=path.join(__dirname,'quizzes');
  return fs.readdirSync(folder).filter(f=>f.endsWith('.json')).map(f=>{
    const quiz=JSON.parse(fs.readFileSync(path.join(folder,f),'utf8'));
    if (!/^[\w-]{2,60}$/.test(quiz.id) || !quiz.title || !Array.isArray(quiz.questions) || quiz.questions.length<1 || quiz.questions.length>100) throw Error('Bad quiz file '+f);
    if (!(Number.isInteger(quiz.duration) && quiz.duration >= 5 && quiz.duration <= 120)) throw Error('Bad duration in '+f);
    quiz.questions.forEach((q, i)=>{
      if (typeof q.prompt !== 'string' || q.prompt.length>300 || !Array.isArray(q.options) || q.options.length!==4 || q.options.some(x=>typeof x!=='string' || x.length>150) || !Number.isInteger(q.correct) || q.correct<0 || q.correct>3) throw Error('Bad question '+(i+1)+' in '+f);
    });
    return quiz;
  });
}
const quizzes=loadQuizzes();
if (!quizzes.length) throw Error('Provide at least one quiz JSON in quizzes/');
const publicQuizzes=quizzes.map(q=>({id:q.id,title:q.title,subtitle:q.subtitle,questions:q.questions.length,duration:q.duration}));
function newPin(){
  for(let i=0;i<50;i++){
    const pin=String(crypto.randomInt(100000,1000000));
    if(!games.has(pin))return pin;
  }
  throw Error('PIN space exhausted');
}
function playersList(game){
  return [...game.players.values()].map(p=>({name:p.name,score:p.score,connected:p.connected,answered:p.lastAnswered === game.questionIndex,answerCount:p.answerCount,correctCount:p.correctCount}));
}
function ranks(game){
  return [...game.players.values()].sort((a,b)=>b.score-a.score || b.correctCount-a.correctCount || a.joinedAt-b.joinedAt || a.name.localeCompare(b.name)).map((p,i)=>({rank:i+1,name:p.name,score:p.score,correctCount:p.correctCount,answerCount:p.answerCount}));
}
function publicState(game, token, isHost){
  const common={pin:game.pin,title:game.quiz.title,subtitle:game.quiz.subtitle,status:game.status,questionIndex:game.questionIndex,totalQuestions:game.quiz.questions.length,players:playersList(game),isHost};
  if(game.status==='question' || game.status==='reveal'){
    const q=game.quiz.questions[game.questionIndex];
    common.question={prompt:q.prompt,options:q.options,number:game.questionIndex+1,total:game.quiz.questions.length,endsAt:game.endsAt,duration:game.quiz.duration};
    if(game.status==='reveal')common.reveal={correct:q.correct,counts:[0,1,2,3].map(i=>[...game.players.values()].filter(p=>p.answers[game.questionIndex]?.selected===i).length)};
  }
  if(game.status==='podium')common.ranking=ranks(game).slice(0,3);
  if(game.status==='leaderboard')common.ranking=ranks(game);
  if(!isHost){
    const p=game.players.get(token);
    common.me=p?{name:p.name,score:p.score,lastAnswer: p.answers[game.questionIndex] ? (game.status==='question' ? {selected:p.answers[game.questionIndex].selected} : p.answers[game.questionIndex]) : null}:null;
    // Never reveal the answer or other students' selections before reveal.
  }
  return common;
}
function emitState(game){
  const host=io.sockets.sockets.get(game.hostSocketId);
  if(host)host.emit('game:state',publicState(game,game.hostToken,true));
  for(const [token,player] of game.players){
    const sock=io.sockets.sockets.get(player.socketId);
    if(sock)sock.emit('game:state',publicState(game,token,false));
  }
}
function clearTimer(game){if(game.timer) clearTimeout(game.timer);game.timer=null;}
function reveal(game){
  if(game.status!=='question')return;
  clearTimer(game);game.status='reveal';emitState(game);
}
function nextQuestion(game){
  clearTimer(game);
  game.questionIndex++;
  game.status='question';
  game.endsAt=Date.now()+game.quiz.duration*1000;
  emitState(game);
  game.timer=setTimeout(()=>reveal(game),game.quiz.duration*1000);
}
function pruneExpiredGames(){
  const now=Date.now();
  for(const [pin,g] of games){
    if(now-g.createdAt > 24*60*60*1000){clearTimer(g);games.delete(pin);}
  }
}
setInterval(pruneExpiredGames,60*60*1000).unref();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname,'public'),{ extensions:['html'] }));
app.get('/health',(_req,res)=>res.json({status:'ok',quizCount:quizzes.length}));
app.get('/api/quizzes',(_req,res)=>res.json(publicQuizzes));
app.get('/join/:pin',(req,res)=>res.redirect('/?pin='+encodeURIComponent(req.params.pin)));
app.get('/teacher',(_req,res)=>res.sendFile(path.join(__dirname,'public','teacher.html')));

io.on('connection', socket=>{
  const member = {pin:null,role:null,token:null};
  function attach(game,role,token){
    if(member.pin)socket.leave(roomName(member.pin));
    member.pin=game.pin;member.role=role;member.token=token;
    socket.join(roomName(game.pin));
  }
  socket.on('host:create',(payload={},ack)=>{
    if(!secureEqual(payload.password,ADMIN_PASSWORD))return fail(ack,'Incorrect teacher password.');
    const quiz=quizzes.find(q=>q.id===payload.quizId);
    if(!quiz)return fail(ack,'Choose an available quiz.');
    const pin=newPin(), hostToken=makeToken();
    const game={pin,quiz,hostToken,hostSocketId:socket.id,players:new Map(),status:'lobby',questionIndex:-1,endsAt:null,timer:null,createdAt:Date.now()};
    games.set(pin,game);attach(game,'host',hostToken);
    ok(ack,{pin,hostToken});emitState(game);
  });
  socket.on('host:resume',(payload={},ack)=>{
    const pin=textTrim(payload.pin,6);const game=games.get(pin);
    if(!game || !secureEqual(payload.hostToken,game.hostToken))return fail(ack,'Host session expired. Create a new game.');
    game.hostSocketId=socket.id;attach(game,'host',game.hostToken);
    ok(ack,{pin,hostToken:game.hostToken});emitState(game);
  });
  socket.on('player:join',(payload={},ack)=>{
    const pin=textTrim(payload.pin,6),name=textTrim(payload.name,24).replace(/[<>\u0000-\u001f]/g,'');
    const game=games.get(pin);
    if(!/^\d{6}$/.test(pin)||!game)return fail(ack,'Game not found. Check the six-digit PIN.');
    if(name.length<2)return fail(ack,'Please enter a name (at least 2 characters).');
    if(game.status!=='lobby')return fail(ack,'This game has already started.');
    if(game.players.size >= 80)return fail(ack,'This game is full (80 students).');
    if([...game.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase()))return fail(ack,'That name is taken. Choose another.');
    const token=makeToken();
    const player={name,token,socketId:socket.id,connected:true,joinedAt:Date.now(),score:0,lastAnswered:-1,answerCount:0,correctCount:0,answers:{}};
    game.players.set(token,player);attach(game,'player',token);
    ok(ack,{pin,playerToken:token,name});emitState(game);
  });
  socket.on('player:resume',(payload={},ack)=>{
    const pin=textTrim(payload.pin,6),game=games.get(pin),token=textTrim(payload.playerToken,100);
    if(!game || !game.players.has(token))return fail(ack,'Previous game session not found.');
    const player=game.players.get(token);
    player.connected=true;player.socketId=socket.id;
    attach(game,'player',token);
    ok(ack,{pin,name:player.name});emitState(game);
  });
  function hostAction(action,ack){
    const game=games.get(member.pin);
    if(!game || member.role!=='host' || !secureEqual(member.token,game.hostToken) || game.hostSocketId!==socket.id)return fail(ack,'Not authorized as teacher.');
    if(action==='start'){
      if(game.status!=='lobby')return fail(ack,'The game already started.');
      if(game.players.size===0)return fail(ack,'Wait until at least one student joins.');
      nextQuestion(game);
    }else if(action==='next'){
      if(game.status==='question')reveal(game);
      else if(game.status==='reveal'){
        if(game.questionIndex+1<game.quiz.questions.length)nextQuestion(game);
        else{game.status='podium';emitState(game);}
      }else if(game.status==='podium'){
        game.status='leaderboard';emitState(game);
      }else return fail(ack,'Nothing to advance yet.');
    }else return fail(ack,'Unknown teacher action.');
    ok(ack);
  }
  socket.on('host:start',(_payload,ack)=>hostAction('start',ack));
  socket.on('host:next',(_payload,ack)=>hostAction('next',ack));
  socket.on('player:answer',(payload={},ack)=>{
    const game=games.get(member.pin);
    if(!game || member.role!=='player' || !game.players.has(member.token))return fail(ack,'You are not in a game.');
    const player=game.players.get(member.token);
    if(player.socketId!==socket.id)return fail(ack,'Reconnected on another tab.');
    if(game.status!=='question' || Date.now()>game.endsAt)return fail(ack,'Answer window has closed.');
    if(player.answers[game.questionIndex])return fail(ack,'Answer already submitted.');
    const selected=payload.selected;
    if(!Number.isInteger(selected)||selected<0||selected>3)return fail(ack,'Invalid answer.');
    const q=game.quiz.questions[game.questionIndex],correct=selected===q.correct;
    const timeRemaining=Math.max(0,game.endsAt-Date.now());
    const points=correct?Math.round(500+500*timeRemaining/(game.quiz.duration*1000)):0;
    player.answers[game.questionIndex]={selected,correct,points};
    player.score+=points;player.lastAnswered=game.questionIndex;player.answerCount++;
    if(correct)player.correctCount++;
    ok(ack,{selected});emitState(game);
    if([...game.players.values()].every(p=>p.answers[game.questionIndex]))reveal(game);
  });
  socket.on('disconnect',()=>{
    const game=games.get(member.pin);
    if(!game)return;
    if(member.role==='player'){
      const p=game.players.get(member.token);
      if(p && p.socketId===socket.id){p.connected=false;p.socketId=null;emitState(game);}
    }else if(member.role==='host' && game.hostSocketId===socket.id){game.hostSocketId=null;}
  });
});

if(require.main===module)httpServer.listen(PORT,'0.0.0.0',()=>console.log(`WordRush listening on http://localhost:${PORT}`));
module.exports={app,httpServer,io,games,quizzes};
