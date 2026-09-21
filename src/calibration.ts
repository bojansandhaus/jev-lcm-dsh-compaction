import { Settings, settings } from './settings.js';
export class JevThresholdCalibrator {
  samples:number[]=[]; current:number; calibrated=false;
  constructor(readonly config:Settings=settings()){this.current=config.keep_threshold;}
  observe(values:number[]):number {
    if (values.some(v=>!Number.isFinite(v)||v<0||v>1)) throw new Error('invalid probability');
    this.samples.push(...values); this.samples=this.samples.slice(-this.config.jev_calibration_window);
    this.current=this.config.keep_threshold;
    this.calibrated=this.config.jev_calibration_enabled && this.samples.length>=this.config.jev_calibration_min_samples;
    if (this.calibrated) {
      const data=[...this.samples].sort((a,b)=>a-b);
      const q=this.config.min_keep_rate-(this.config.conservative?Math.sqrt(Math.log(20)/(2*data.length)):0);
      const p=(data.length-1)*q,lo=Math.floor(p),hi=Math.min(lo+1,data.length-1);
      this.current=q<0?0:Math.min(this.config.keep_threshold_max,data[lo]+(data[hi]-data[lo])*(p-lo));
    }
    return this.current;
  }
  retainedIndices(values:number[]):Set<number>{
    const out=new Set(values.flatMap((v,i)=>v>=this.current?[i]:[]));
    values.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v||a.i-b.i).slice(0,Math.ceil(values.length*this.config.min_keep_rate)).forEach(x=>out.add(x.i));
    return out;
  }
}
