# 🌿 Steady — Mental Wellness Tracker for Exam Season

A calm, engaging tool that helps students **monitor and improve their mental well-being** during board exams, competitive entrance tests (NEET, JEE, CUET, CAT, GATE, UPSC), and result seasons.

Built for **PromptWars / Build with AI**.

**Live demo:** _add your Vercel URL here_

---

## How it meets the challenge

The problem asks for a simple, engaging tool that lets students **track their mood, identify stress triggers, reflect on their emotions, and receive personalized wellness support**. Each requirement maps to a feature:

| Requirement | How Steady delivers it |
|---|---|
| **Track mood** | Daily 1–5 mood check-in with expressive emoji; saved on-device, shown as a 7-day trend chart, streak, and average. |
| **Identify stress triggers** | Tap-to-select trigger chips (exam pressure, sleep, peer comparison, fear of results, family expectations, self-doubt, burnout, uncertainty) + a **"Top stress triggers"** insight that tallies patterns over time. |
| **Reflect on emotions** | Optional private journal on every check-in; the AI responds with a warm, specific reflection. |
| **Personalized wellness support** | Google **Gemini** generates a tailored reflection, 3 concrete coping actions, and a grounding affirmation based on the student's exact mood, triggers, and reflection. |
| **Simple & engaging** | One-screen flow, streak + trend gamification, calming animated UI, breathing-circle loader. |

## Responsible-AI / safety design

This is a mental-health context, so safety is built in, not bolted on:
- The AI is instructed **not to diagnose or use clinical labels**, only to support and encourage.
- It returns a `concern` flag; if a reflection suggests serious distress, the UI gently encourages reaching out and surfaces help.
- **Always-visible crisis resources** (Tele-MANAS `14416`, KIRAN `1800-599-0019`, iCall) and a clear note that Steady is not a substitute for professional care.
- All data stays **on the student's device** (localStorage) — nothing is uploaded.

## Tech
- Vanilla HTML / CSS / JS — no build step, deploys anywhere
- **Google Gemini** (`gemini-1.5-flash`) for personalized support
- localStorage persistence so trends, streaks and insights are real
- Pure logic separated from DOM for testability

## Setup & deploy (Vercel)
The Gemini key is **never** stored in the repo. It lives in a serverless function (`/api/generate`) and is read from an environment variable.

1. Get a free key from <https://aistudio.google.com/apikey>
2. Push this repo to GitHub
3. Import the repo at [vercel.com](https://vercel.com) → **Add New → Project**
4. Before deploying, open **Environment Variables** and add:
   `GEMINI_API_KEY` = _your key_
5. Click **Deploy**

For local dev you can run it with the Vercel CLI (`vercel dev`) after setting the same env var.

## Tests
```bash
npm test
```
Zero-dependency suite — **20 tests** covering HTML escaping, mood averaging, streak logic, trigger tallying, JSON extraction, and prompt construction.

## Accessibility
Skip link, semantic landmarks, labelled controls, keyboard-operable mood radios and trigger chips (`role`, `aria-checked`, `aria-pressed`), `aria-live` regions, visible focus rings, and `prefers-reduced-motion` support.

## Security
The Gemini key is held **server-side** in a serverless function and injected via an environment variable, so it never reaches the browser or the git repo. Model output is HTML-escaped before rendering, and all student data stays in the browser's localStorage.

## License
MIT
