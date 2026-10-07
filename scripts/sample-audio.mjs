import {mkdir,writeFile} from 'node:fs/promises';
// Original synthesized UI sample; this is not a recording or a product measurement.
const rate=44100,frames=rate,bytes=Buffer.alloc(44+frames*2);
bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
let seed=71;for(let i=0;i<frames;i++){const t=i/rate;let sample=0;for(const start of [0.2,0.64]){const x=t-start;if(x>=0&&x<0.09){seed=(Math.imul(seed,1664525)+1013904223)>>>0;sample+=0.18*Math.exp(-x*95)*(Math.sin(2*Math.PI*2300*x)+0.3*(seed/4294967296-0.5));}}bytes.writeInt16LE(Math.round(sample*32767),44+i*2);}
await mkdir('public/audio',{recursive:true});await writeFile('public/audio/sample-click.wav',bytes);console.log('Original illustrative sample: public/audio/sample-click.wav');
