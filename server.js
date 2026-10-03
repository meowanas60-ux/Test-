const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data.json');
const MEDIA = path.join(__dirname, 'media');
fs.mkdirSync(MEDIA, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA));

const uid = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();

function defaultDB() {
  return {
    apis: [
      { id:'demo-luma', name:'Luma', type:'video-generation', endpoint:'https://api.lumalabs.ai', model:'ray-2', enabled:true, apiKey:'' },
      { id:'demo-runway', name:'Runway', type:'video-generation', endpoint:'https://api.dev.runwayml.com', model:'gen4.5', enabled:true, apiKey:'' },
      { id:'demo-shotstack', name:'Shotstack', type:'video-editing', endpoint:'https://api.shotstack.io', model:'v1', enabled:true, apiKey:'' },
      { id:'demo-tts', name:'TTS Provider', type:'voice-generation', endpoint:'', model:'standard', enabled:true, apiKey:'' }
    ],
    projects: [],
    jobs: [],
    settings: {
      autoPublish:false,
      defaultVoice:'neutral',
      voiceLanguage:'en-US',
      subtitleStyle:'clean',
      backgroundMusic:true,
      targetAspect:'9:16'
    }
  };
}
function load() {
  if (!fs.existsSync(DATA)) fs.writeFileSync(DATA, JSON.stringify(defaultDB(), null, 2));
  const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  db.jobs ||= [];
  db.settings ||= defaultDB().settings;
  return db;
}
function save(db) { fs.writeFileSync(DATA, JSON.stringify(db, null, 2)); }
function splitStory(story) {
  if (!story) return ['Create an opening cinematic scene for this story.'];
  const parts = story.split(/(?<=[.!?।])\s+/).filter(Boolean);
  return parts.length <= 1 ? [story] : parts;
}
function makeScenePrompt(text) {
  return `${text}. Cinematic composition, natural motion, coherent characters, detailed environment, vertical social-video framing.`;
}
function sceneFromText(text, order) {
  return {
    id: uid(), order, sourceText: text, prompt: makeScenePrompt(text), duration: 5,
    provider: null, status:'queued', videoUrl:null,
    voiceover:{ text:text, provider:null, voiceUrl:null, status:'queued' },
    captions:{ enabled:true, status:'queued', url:null },
    music:{ enabled:true, status:'queued' }
  };
}

app.get('/api/state', (req,res)=>res.json(load()));
app.get('/api/health', (req,res)=>res.json({ ok:true, service:'Carvo AI Content Automation Hub', version:'0.2.0' }));

app.post('/api/apis', (req,res)=>{
  const db=load();
  const item={ id:uid(), name:req.body.name||'New Provider', type:req.body.type||'video-generation', endpoint:req.body.endpoint||'', model:req.body.model||'', enabled:req.body.enabled!==false, apiKey:req.body.apiKey||'' };
  db.apis.push(item); save(db); res.json(safeProvider(item));
});
app.patch('/api/apis/:id',(req,res)=>{
  const db=load(); const item=db.apis.find(x=>x.id===req.params.id);
  if(!item) return res.status(404).json({error:'Provider not found'});
  Object.assign(item, req.body); save(db); res.json(safeProvider(item));
});
app.delete('/api/apis/:id',(req,res)=>{ const db=load(); db.apis=db.apis.filter(x=>x.id!==req.params.id); save(db); res.json({ok:true}); });
function safeProvider(p){ return {...p, apiKey:p.apiKey ? '••••••••' : ''}; }

app.post('/api/projects', (req,res)=>{
  const db=load();
  const story=(req.body.story||'').trim();
  const rawScenes=Array.isArray(req.body.scenes)&&req.body.scenes.length ? req.body.scenes : splitStory(story);
  const project={
    id:uid(), title:req.body.title||'Untitled Story', story, status:'planned', progress:0,
    scenes:rawScenes.map((s,i)=>sceneFromText(typeof s==='string'?s:(s.text||s.prompt||''), i+1)),
    voice:{ enabled:req.body.voiceEnabled!==false, provider:null, voice:req.body.voice||db.settings.defaultVoice, language:req.body.language||db.settings.voiceLanguage },
    captions:{ enabled:req.body.captionsEnabled!==false, style:req.body.subtitleStyle||db.settings.subtitleStyle },
    music:{ enabled:req.body.musicEnabled!==false },
    aspectRatio:req.body.aspectRatio||db.settings.targetAspect,
    render:{ status:'not-started', videoUrl:null },
    createdAt:now(), updatedAt:now()
  };
  const generators=db.apis.filter(x=>x.enabled&&x.type==='video-generation');
  const tts=db.apis.filter(x=>x.enabled&&x.type==='voice-generation');
  project.scenes.forEach((s,i)=>{ s.provider=generators[i % Math.max(generators.length,1)]?.name||'Not configured'; s.voiceover.provider=tts[0]?.name||'Not configured'; });
  db.projects.unshift(project); save(db); res.json(project);
});

app.get('/api/projects/:id',(req,res)=>{ const p=load().projects.find(x=>x.id===req.params.id); if(!p) return res.status(404).json({error:'Project not found'}); res.json(p); });

app.post('/api/projects/:id/run', async (req,res)=>{
  const db=load(); const p=db.projects.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({error:'Project not found'});
  p.status='running'; p.updatedAt=now();
  const job={id:uid(), projectId:p.id, type:'full-pipeline', status:'queued', createdAt:now(), logs:['Pipeline queued']};
  db.jobs.unshift(job); save(db);
  runPipeline(job.id);
  res.json({ok:true, jobId:job.id, project:p});
});

app.post('/api/projects/:id/voiceover', async (req,res)=>{
  const db=load(); const p=db.projects.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({error:'Project not found'});
  p.voice={...p.voice, ...req.body, enabled:req.body.enabled!==false};
  p.scenes.forEach(s=>{ s.voiceover.text=req.body.sceneText?.[s.id] || s.voiceover.text || s.sourceText; s.voiceover.status='queued'; });
  save(db);
  res.json({ok:true, message:'Voiceover plan saved. Connect a TTS adapter to synthesize audio.', project:p});
});

app.post('/api/projects/:id/render', async (req,res)=>{
  const db=load(); const p=db.projects.find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({error:'Project not found'});
  const job={id:uid(), projectId:p.id, type:'render', status:'queued', createdAt:now(), logs:['Render queued']};
  db.jobs.unshift(job); save(db); runRender(job.id); res.json({ok:true, jobId:job.id});
});

app.get('/api/jobs',(req,res)=>res.json(load().jobs));
app.get('/api/jobs/:id',(req,res)=>{ const j=load().jobs.find(x=>x.id===req.params.id); if(!j) return res.status(404).json({error:'Job not found'}); res.json(j); });

app.post('/api/settings',(req,res)=>{ const db=load(); db.settings={...db.settings,...req.body}; save(db); res.json(db.settings); });

function updateJob(id, patch){ const db=load(); const j=db.jobs.find(x=>x.id===id); if(!j) return; Object.assign(j,patch); save(db); return j; }
function logJob(id, message){ const db=load(); const j=db.jobs.find(x=>x.id===id); if(!j) return; j.logs ||= []; j.logs.push(`${new Date().toLocaleTimeString()} — ${message}`); save(db); }

async function runPipeline(jobId){
  const db=load(); const job=db.jobs.find(x=>x.id===jobId); if(!job) return;
  const p=db.projects.find(x=>x.id===job.projectId); if(!p) return;
  updateJob(jobId,{status:'processing'}); logJob(jobId,'Scene planning complete');
  for (const scene of p.scenes) {
    scene.status='generating'; save(db); logJob(jobId,`Generating scene ${scene.order}`);
    await wait(350);
    scene.status='video-ready'; scene.videoUrl=null;
    scene.voiceover.status=p.voice.enabled?'ready-for-tts':'skipped';
    scene.captions.status=p.captions.enabled?'ready':'skipped';
    scene.music.status=p.music.enabled?'ready':'skipped';
    p.progress=Math.round((scene.order/p.scenes.length)*75); p.updatedAt=now(); save(db);
    logJob(jobId,`Scene ${scene.order} ready for provider adapter`);
  }
  p.status='ready-to-render'; p.progress=75; save(db); logJob(jobId,'All scenes prepared; voiceover/captions/music stages are ready'); updateJob(jobId,{status:'completed',completedAt:now()});
}

function runRender(jobId){
  setTimeout(()=>{
    const db=load(); const job=db.jobs.find(x=>x.id===jobId); if(!job) return; const p=db.projects.find(x=>x.id===job.projectId); if(!p) return;
    updateJob(jobId,{status:'processing'}); logJob(jobId,'Building render manifest');
    const manifest={ projectId:p.id, aspectRatio:p.aspectRatio, scenes:p.scenes.map(s=>({order:s.order,video:s.videoUrl,duration:s.duration,voice:s.voiceover.voiceUrl,captions:s.captions.url,music:s.music.enabled})), createdAt:now() };
    const file=path.join(MEDIA,`${p.id}-render-manifest.json`); fs.writeFileSync(file,JSON.stringify(manifest,null,2));
    p.render={status:'render-manifest-ready',videoUrl:`/media/${path.basename(file)}`}; p.status='render-ready'; p.progress=100; p.updatedAt=now(); save(db);
    logJob(jobId,'Render manifest created. Replace mock media with provider outputs to produce final MP4.'); updateJob(jobId,{status:'completed',completedAt:now()});
  },300);
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

app.listen(PORT, ()=>console.log(`Carvo: http://localhost:${PORT}`));
