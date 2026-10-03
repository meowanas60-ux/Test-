# Carvo — AI Content Automation Hub

Carvo is a foundation for an AI content automation platform: story planning, video-provider routing, voiceover/TTS, captions, music, rendering, and later social publishing.

## Current build (v0.2)

- Dashboard + project management
- Story → scene planner
- Provider registry for video, voice and editing providers
- Per-scene voiceover plan
- Caption/subtitle stage
- Background music stage
- Aspect-ratio/render settings
- Long-running pipeline job model
- Render manifest generation
- `/media` asset boundary
- Provider adapter boundaries without exposing API keys in the UI

### Important
The current pipeline intentionally uses **provider-ready/mock stages**. It does not pretend that a video or TTS provider has generated media when no real provider credentials/adapter are connected.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000

## Target production pipeline

Story
→ AI story planner
→ scene prompts
→ provider router
→ video generation jobs
→ download/normalize clips
→ TTS voiceover
→ timed captions
→ background music
→ FFmpeg/cloud render
→ thumbnail + metadata
→ approval/schedule
→ official social APIs
→ analytics

## Next engineering steps

1. PostgreSQL + migrations
2. Authentication/RBAC
3. Encrypted provider secrets
4. Real LLM scene planner
5. Real video provider adapters
6. Redis/BullMQ workers + retries/webhooks
7. Real TTS adapter(s)
8. FFmpeg render worker
9. Object storage (S3-compatible)
10. Official OAuth publishing integrations
11. Usage/credits/billing
12. Moderation, audit logs and observability
