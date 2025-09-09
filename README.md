# slocial.org

A slow social app for reflective, high-quality interactions. Letters publish after 12 hours; you can write once per day.

## Dev

- Copy `.env.example` to `.env` and set a `SESSION_SECRET`
- Install deps: `npm i`
- Start dev server: `npm run dev`
- Open http://localhost:3000

## Deploy (Render)

1. Push this repo to GitHub
2. In Render, New + → Blueprint → point to this repo
3. Render reads `render.yaml` and provisions a Web Service with a persistent disk
4. Set a custom domain `slocial.org` in Render, add DNS per instructions
5. Data persists in `/var/data/slocial.db`

## Concept

- Letters steep for 12h before publishing
- One letter per 24h per user
- One thoughtful comment per person per letter
- Resonates avoid counters to reduce gamification

