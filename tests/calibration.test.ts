import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { JevThresholdCalibrator } from '../src/calibration.js';

test('calibration and minimum retention',()=>{const c=new JevThresholdCalibrator();const values=Array.from({length:500},(_,i)=>i/2500);assert.ok(Math.abs(c.observe(values)-.01996)<1e-12);assert.ok(c.retainedIndices(values).size>=50);assert.equal(new JevThresholdCalibrator(settings({conservative:true})).observe(Array(50).fill(.1)),0);});
