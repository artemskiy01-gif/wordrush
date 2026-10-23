'use strict';
const {test, after}=require('node:test');
const assert=require('node:assert/strict');
const { io:client }=require('socket.io-client');
process.env.TEACHER_PASSWORD='test-password-1234';
const {httpServer,quizzes,io,games}=require('../server');
let base,clients=[];
after(async()=>{for(const s of clients)s.disconnect();io.close();await new Promise(resolve=>httpServer.close(resolve));});
async function server(){if(!base){await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+httpServer.address().port;}return base;}
async function connection(){let s=client(await server(),{reconnection:false});clients.push(s);await new Promise((res,rej)=>{s.on('connect',res);s.on('connect_error',rej)});return s;}
function emit(s,name,body){return new Promise((resolve,reject)=>s.timeout(1500).emit(name,body,(err,r)=>err?reject(err):resolve(r)));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('quiz structure and 20 questions',()=>{
  assert.ok(quizzes.length>=1);
  assert.equal(quizzes.find(x=>x.id==='holidays-2a').questions.length,20);
});
test('teacher lobby → student joins → play → podium → full results',async()=>{
  const host=await connection();
  assert.equal((await emit(host,'host:create',{password:'wrong',quizId:'holidays-2a'})).ok,false);
  let created=await emit(host,'host:create',{password:'test-password-1234',quizId:'holidays-2a'});
  assert.equal(created.ok,true);assert.match(created.pin,/^\d{6}$/);
  const pin=created.pin;
  assert.equal((await emit(host,'host:start',{})).ok,false);
  const alice=await connection(),bob=await connection();
  assert.equal((await emit(alice,'player:join',{pin:'000001',name:'Alice'})).ok,false);
  const ar=await emit(alice,'player:join',{pin,name:'Alice'});
  assert.equal(ar.ok,true);
  assert.equal((await emit(bob,'player:join',{pin,name:'Alice'})).ok,false);
  const br=await emit(bob,'player:join',{pin,name:'Bob'});
  assert.equal(br.ok,true);
  assert.equal((await emit(host,'host:start',{})).ok,true);
  assert.equal(games.get(pin).status,'question');
  let current=games.get(pin).quiz.questions[0];
  const correct=current.correct;
  let r=await emit(alice,'player:answer',{selected:correct});assert.equal(r.ok,true);
  assert.equal((await emit(alice,'player:answer',{selected:correct})).ok,false);
  r=await emit(bob,'player:answer',{selected:(correct+1)%4});assert.equal(r.ok,true);
  assert.equal(games.get(pin).status,'reveal');
  assert.ok(games.get(pin).players.get(ar.playerToken).score>=500);
  assert.equal(games.get(pin).players.get(br.playerToken).score,0);
  for(let i=1;i<20;i++){
    assert.equal((await emit(host,'host:next',{})).ok,true);
    assert.equal(games.get(pin).status,'question');
    current=games.get(pin).quiz.questions[i];
    await emit(alice,'player:answer',{selected:current.correct});
    await emit(bob,'player:answer',{selected:(current.correct+1)%4});
    assert.equal(games.get(pin).status,'reveal');
  }
  assert.equal((await emit(host,'host:next',{})).ok,true);
  assert.equal(games.get(pin).status,'podium');
  assert.equal((await emit(host,'host:next',{})).ok,true);
  assert.equal(games.get(pin).status,'leaderboard');
  assert.equal(games.get(pin).players.get(ar.playerToken).correctCount,20);
  assert.equal(games.get(pin).players.get(br.playerToken).correctCount,0);
  assert.equal((await emit(host,'host:next',{})).ok,false);
  assert.equal((await emit(bob,'host:next',{})).ok,false);
  const alice2=await connection();assert.equal((await emit(alice2,'player:resume',{pin,playerToken:ar.playerToken})).ok,true);
  const host2=await connection();assert.equal((await emit(host2,'host:resume',{pin,hostToken:created.hostToken})).ok,true);
  assert.equal((await emit(host2,'host:start',{})).ok,false);
});
