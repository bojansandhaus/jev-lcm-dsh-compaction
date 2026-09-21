export class Batcher {turns=0;constructor(readonly window=3){}tick(){this.turns+=1;}ready(force=false){return force||this.turns>=this.window;}flushed(){this.turns=0;}}
