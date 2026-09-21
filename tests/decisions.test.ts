import test from 'node:test';
import assert from 'node:assert/strict';
import { Candidate } from '../src/anchors.js';
import { decide,questions } from '../src/decisions.js';

function candidate(kind:Candidate['kind']):Candidate{return {id:'x',kind,message_index:1,text:'exact',start:0,end:5,scores:{},action:'unscored',jev_unscored:true};}

test('decision table: keep, truncate and drop for calls and anchors',()=>{
 const cases:[Candidate['kind'],number,number,Candidate['action']][]=[['tool',.1,.2,'keep'],['tool',.2,.1,'truncate'],['tool',.1,.1,'drop'],['anchor',.2,.1,'keep'],['anchor',.1,.1,'drop']];
 for(const [kind,a,b,action] of cases){
  const c=candidate(kind);
  const names=Object.keys(questions(c));
  assert.equal(names.length,2);
  decide(c,{[names[0]]:a,[names[1]]:b},.15);
  assert.equal(c.action,action);
  assert.equal(c.jev_unscored,false);
  assert.equal(Object.keys(c.scores).length,2);
 }
});

test('the retention floor keeps an anchor or result below the threshold',()=>{
 const anchor=candidate('anchor');
 const names=Object.keys(questions(anchor));
 decide(anchor,{[names[0]]:.01,[names[1]]:.01},.15,true);
 assert.equal(anchor.action,'keep');
 const tool=candidate('tool');
 const toolNames=Object.keys(questions(tool));
 decide(tool,{[toolNames[0]]:.01,[toolNames[1]]:.01},.15,true);
 assert.equal(tool.action,'keep');
});
