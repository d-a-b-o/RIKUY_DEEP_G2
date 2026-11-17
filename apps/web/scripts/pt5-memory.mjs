import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// Run from apps/web. No database, account, camera permission or production writes.
const manifestUrl = process.env.PT5_MANIFEST_URL;
if (!manifestUrl || new URL(manifestUrl).protocol !== "https:") throw new Error("Set PT5_MANIFEST_URL to the public HTTPS manifest");
const destination = path.resolve(process.env.PT5_OUTPUT ?? "../../docs/evidencias/RIKDP-230/memory.json");
const assets = new Map();
const hashes = [];
async function download(url, local) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assets.set(local, bytes);
  hashes.push({ path: local, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  return bytes;
}
const manifest = JSON.parse(await download(manifestUrl, "/model/manifest.json"));
const active = manifest.versions.find(v => v.version === manifest.activeVersion);
const modelUrl = new URL(active.modelPath, manifestUrl);
const modelPath = new URL(active.modelPath, "http://localhost/model/manifest.json").pathname;
const graphBytes = await download(modelUrl, modelPath);
if (active.modelSha256 && createHash("sha256").update(graphBytes).digest("hex") !== active.modelSha256) throw new Error("Model hash mismatch");
const graph = JSON.parse(graphBytes);
for (const group of graph.weightsManifest) for (const shard of group.paths) {
  const local = new URL(shard, "http://localhost" + modelPath).pathname;
  if (!assets.has(local)) await download(new URL(shard, modelUrl), local);
}
const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
  import * as tf from '@tensorflow/tfjs-core';
  import '@tensorflow/tfjs-backend-cpu';
  import {loadInspectionModel} from './src/lib/model/loader';
  import {drawModelInput} from './src/lib/model/preprocess';
  window.pt5 = async () => {
    const snapshot = () => { const m=tf.memory(); return {numTensors:m.numTensors,numDataBuffers:m.numDataBuffers,numBytes:m.numBytes,unreliable:m.unreliable,reasons:m.reasons}; };
    await tf.setBackend('cpu');await tf.ready();const before=snapshot();
    const model=await loadInspectionModel(location.origin+'/model/manifest.json');console.log('PT5 model ready '+model.info.backend);
    const canvas=document.createElement('canvas'); canvas.width=640;canvas.height=480;
    const ctx=canvas.getContext('2d');
    const stream=canvas.captureStream(2);ctx.fillStyle='#777';ctx.fillRect(0,0,640,480);
    const video=document.createElement('video');video.muted=true;video.srcObject=stream;
    document.body.append(video);await video.play();
    const input=document.createElement('canvas');
    let tick=0;
    const paint=()=>{ctx.fillStyle=tick++%2?'#777':'#333';ctx.fillRect(0,0,640,480);ctx.fillStyle='#ddd';ctx.fillRect(100+tick%20,90,200,200);};
    const timer=setInterval(paint,500);paint();
    const frame=async()=>{drawModelInput(video,input,model.info.input);return model.predict(input);};
    const samples=[];const starts=[];let baseline;let after;let elapsed;
    try {
      for(let i=0;i<10;i++)await frame();
      baseline=snapshot();const begin=performance.now();
      for(let i=0;i<1200;i++){
        await new Promise(r=>setTimeout(r,Math.max(0,begin+i*500-performance.now())));
        starts.push(performance.now()-begin);
        const result=await frame();samples.push({frame:i+1,atMs:performance.now()-begin,inferenceMs:result.inferenceMs,...snapshot()});
        if((i+1)%120===0)console.log('PT5 frames '+(i+1)+'/1200');
      }
      await new Promise(r=>setTimeout(r,Math.max(0,begin+600000-performance.now())));
      elapsed=performance.now()-begin;
    } finally {clearInterval(timer);stream.getTracks().forEach(t=>t.stop());video.srcObject=null;video.remove();model.dispose();after=snapshot();}
    return {before,baseline,after,elapsedMs:elapsed,starts,samples,model:model.info,tracksStopped:stream.getTracks().every(t=>t.readyState==='ended')};
  };` }, bundle: true, write: false, platform: "browser", format: "iife", alias: { "@": path.resolve("src") }, define: { "process.env.NODE_ENV": '"production"' } });
const server = createServer((req, res) => {
  if (req.url === "/api/telemetry/model") { res.writeHead(202); res.end('{}'); return; }
  if (assets.has(req.url)) { res.end(assets.get(req.url)); return; }
  if (req.url.startsWith("/tfjs-wasm/")) {
    const file = path.basename(req.url);
    if (!/^[a-z0-9.-]+\.wasm$/.test(file)) {res.writeHead(404);res.end();return;}
    res.setHeader("Content-Type","application/wasm");res.end(readFileSync(path.join("public/tfjs-wasm",file)));return;
  }
  if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script src="/probe.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage();page.on('console',m=>{if(m.text().startsWith('PT5'))console.log(m.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof window.pt5==='function');
  console.log('PT5 starting: real model, real video stream, selected TF backend, 1200 frames over 600 seconds');
  const result=await page.evaluate(()=>window.pt5());
  const keys=['numTensors','numDataBuffers','numBytes'];
  const stable=result.samples.every(s=>keys.every(k=>s[k]===result.baseline[k]));
  const released=keys.every(k=>result.after[k]===result.before[k]);
  const maxLateness=Math.max(...result.starts.map((s,i)=>s-i*500));
  const passed=stable&&released&&result.tracksStopped&&result.samples.length===1200&&result.elapsedMs>=600000&&maxLateness<500;
  const report={checkedAt:new Date().toISOString(),commit:execFileSync('git',['-c','safe.directory='+path.resolve('../..').replaceAll('\\','/'),'rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,browser:browser.version(),node:process.version},manifestUrl,hashes,passed,stable,released,maxLatenessMs:maxLateness,scope:'Synthetic canvas video through HTMLVideoElement and real production loader/preprocessing/model. No physical camera, station UI or business persistence. tf.memory counters do not measure total browser/GPU/process memory.',...result};
  mkdirSync(path.dirname(destination),{recursive:true});writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed,stable,released,maxLatenessMs:maxLateness,baseline:result.baseline,after:result.after,output:destination}));
  if(!passed)process.exitCode=1;
} finally {await browser?.close();await new Promise(r=>server.close(r));}



