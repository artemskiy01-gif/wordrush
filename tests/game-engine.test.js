'use strict';
// Dependency-free unit test harness for the multiplayer state machine.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
process.env.TEACHER_PASSWORD='private-test-secret';
let onConnection;
const socks=new Map();
const mockIo={sockets:{sockets:socks},on:(name,cb)=>{if(name==='connection')onConnection=cb;},close:()=>{}};
function express(){return {disable(){},use(){},get(){}};}
express.static=()=>()=>{};
class FakeServer {constructor(){return mockIo;}}
Module._load=function(req,parent,isMain){
  if(req==='express')return express;
  if(req==='socket.io')return {Server:FakeServer};
  return original.call(this,req,parent,isMain);
};
const {games,quizzes}=require('../server');
Module._load=original;
let id=0;
function connect(){
  const handlers=new Map();const sock={id:'socket'+(++id),on:(ev,cb)=>handlers.set(ev,cb),join(){},leave(){},emit(){},handle(ev,arg){
    let value;const cb=x=>value=x;
    handlers.get(ev)(arg,cb);
    return value;
  }};
  socks.set(sock.id,sock);onConnection(sock);return sock;
}
test('20 vocabulary questions included',()=>assert.equal(quizzes[0].questions.length,20));
test('teacher authorization, classroom, answers, podium and rankings',()=>{
  const host=connect();
  assert.equal(host.handle('host:create',{password:'wrong',quizId:'holidays-2a'}).ok,false);
  const result=host.handle('host:create',{password:'private-test-secret',quizId:'holidays-2a'});
  assert.equal(result.ok,true);
  assert.match(result.pin,/^\d{6}$/);
  assert.equal(host.handle('host:start',{}).ok,false);
  const alice=connect(),bob=connect();
  assert.equal(alice.handle('player:join',{pin:'123',name:'Alice'}).ok,false);
  const a=alice.handle('player:join',{pin:result.pin,name:'Alice'});
  assert.equal(a.ok,true);
  assert.equal(bob.handle('player:join',{pin:result.pin,name:'ALICE'}).ok,false);
  const b=bob.handle('player:join',{pin:result.pin,name:'Bob'});
  assert.equal(b.ok,true);
  const game=games.get(result.pin);
  assert.equal(host.handle('host:start',{}).ok,true);
  for(let i=0;i<20;i++){
    assert.equal(game.questionIndex,i);
    assert.equal(game.status,'question');
    const good=game.quiz.questions[i].correct;
    assert.equal(alice.handle('player:answer',{selected:good}).ok,true);
    assert.equal(alice.handle('player:answer',{selected:good}).ok,false);
    assert.equal(bob.handle('player:answer',{selected:(good+1)%4}).ok,true);
    assert.equal(game.status,'reveal');
    assert.equal(host.handle('host:next',{}).ok,true);
  }
  assert.equal(game.status,'podium');
  assert.equal(host.handle('host:next',{}).ok,true);
  assert.equal(game.status,'leaderboard');
  assert.equal(game.players.get(a.playerToken).correctCount,20);
  assert.equal(game.players.get(b.playerToken).score,0);
  assert.equal(host.handle('host:next',{}).ok,false);
  assert.equal(bob.handle('host:next',{}).ok,false);
  const hostRejoin=connect();
  assert.equal(hostRejoin.handle('host:resume',{pin:result.pin,hostToken:result.hostToken}).ok,true);
  const studentRejoin=connect();
  assert.equal(studentRejoin.handle('player:resume',{pin:result.pin,playerToken:a.playerToken}).ok,true);
});
