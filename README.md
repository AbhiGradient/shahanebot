# 💬 Shahane GPT

A chatbot with a web interface that combines a **C++ program**, a **Node.js + Express server**, and the **Google Gemini API**. It answers general questions and is especially useful for C++ and computer-science topics.

> ⚠️ Honest summary: we did **not** train an AI model, and the AI answers are **not** generated in C++. Gemini (an external API) writes the answers. The C++ program handles calculations and searches the question file for notes that are passed to Gemini.

## ✨ Features

- Answers general questions, C++ concepts, code writing, debugging, maths
- Chat history kept for the current browser session (cleared when the tab is closed)
- Safe formatted answers: code blocks with a **Copy** button, lists, tables
- **Web search** toggle with clickable source links (when Gemini Search grounding is available)
- C++ calculator for plain arithmetic such as `what is (3+4)*5`
- Uses `data/qa_database.txt` as supplementary knowledge (1,114 Q&A pairs)
- Clear errors for missing/invalid key, quota, timeouts and no internet; retry button

## 🏗️ Architecture

```
Browser (HTML + CSS + JS)
      │  POST /api/chat   GET /api/health   GET /api/questions
      ▼
Node.js + Express  (127.0.0.1:3000)  ── reads API key from .env
      │                         │
      │ stdin/stdout JSON       │ HTTPS (server side only)
      ▼                         ▼
bin/ShahaneBot (C++)       Google Gemini API
  CALC   calculator
  SEARCH related Q&A notes
  ASK / LIST / PING
      │
      ▼
data/qa_database.txt
```

**Request flow**

1. Browser sends the message and recent chat history to `/api/chat`.
2. Node validates it (non-empty, max 4000 characters, safe characters).
3. If it is plain arithmetic, the **C++ engine** answers directly.
4. Otherwise the C++ engine searches `qa_database.txt` (`SEARCH`) and up to 3 matching entries are added to the prompt as notes.
5. Node calls Gemini (with Google Search if requested/needed) and extracts the answer and source links.
6. If the AI is unreachable and the question is stored in the file, the C++ answer is returned and **labelled as a local fallback**.

## 📁 Folder structure

```
shahane-gpt/
├── .env                 ← your API key goes here (not committed to Git)
├── .env.example         ← template with placeholders
├── package.json
├── cpp/ShahaneBot.cpp   ← C++ engine (calculator, Q&A search)
├── data/qa_database.txt ← question|answer pairs
├── server/
│   ├── index.js         ← startup, messages
│   ├── config.js        ← .env loading, settings
│   ├── app.js           ← Express routes and security headers
│   ├── chat.js          ← decides calculator / AI / fallback
│   ├── ai.js            ← Gemini API integration
│   └── engine.js        ← talks to the C++ program
├── public/              ← website (index.html, css, js)
└── scripts/             ← build-cpp.js, ensure-cpp.js, smoke-test.js
```

## 🧰 Required software

| Software | Why | Link |
|---|---|---|
| Node.js **20 or newer** (LTS) | Runs the server | https://nodejs.org |
| C++ compiler (g++) | Builds the C++ engine | MSYS2, see below |
| A Gemini API key | AI answers (free tier) | https://aistudio.google.com/apikey |

**Installing g++ on Windows (once)**

1. Install MSYS2 from https://www.msys2.org
2. Open **MSYS2 UCRT64** and run: `pacman -S mingw-w64-ucrt-x86_64-gcc`
3. The build script finds `C:\msys64\ucrt64\bin\g++.exe` automatically. For another location set `CXX` to the full path of `g++.exe`.

## 🚀 Setup (Windows PowerShell)

1. Extract the ZIP, then open the `shahane-gpt` folder in VS Code (**File → Open Folder**).
2. Open the terminal (**Terminal → New Terminal**) and run:

```powershell
npm install
```

3. Open the file **`.env`** (project root, next to `package.json`) and replace the placeholder:

```
GEMINI_API_KEY=PASTE_YOUR_API_KEY_HERE
```

with your key, for example `GEMINI_API_KEY=AIza...`. Save the file (Ctrl+S). If `.env` is missing, start the server once and it is created from `.env.example`.

4. Start the app (this also builds the C++ engine automatically if needed):

```powershell
npm start
```

5. Open **http://localhost:3000**

To build only the C++ program: `npm run build:cpp`. To run the checks: `npm test`.

## ⚙️ Settings in `.env`

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | placeholder | Your key. Stays on the server and is never sent to the browser |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini model name. Change it if Google retires or renames models |
| `GEMINI_GROUNDING` | `auto` | `auto` = search when you switch **Web search** on or the question asks for current info; `on` = always; `off` = never |

Restart the server after editing `.env`.

## 🌐 How source links work

- With **Web search** on (or a question about current events) Gemini is called with the Google Search tool. The links come from the `groundingMetadata` that Gemini returns. Only `https` links are shown, duplicates removed, and they are shown as clickable chips under the answer labelled **Web**.
- For C++ topics we add fixed links to **cppreference.com** and **LearnCpp.com**. They are labelled **Reference**: they are *not* live search results.
- If search is unavailable, the answer says so and a **Search** link (a normal Google search URL) is offered. We never claim a search happened when it did not.

## ⚠️ Free tier and known limitations

- On Google's current price list, Search grounding is **not available on the free tier for Gemini 3 models** (it is on Gemini 2.5 Flash / Flash-Lite, but Google now limits those to projects that already used them). So on a brand-new free key the app will usually answer **without** web sources and tell you so. Enabling billing in Google AI Studio unlocks grounding. This is from Google's pricing page and may change: check https://ai.google.dev/gemini-api/docs/pricing.
- Free-tier requests may be used by Google to improve its products, and rate limits apply.
- Chat history lives only in the browser tab (session storage). Nothing is stored on the server.
- Gemini can be wrong. It cannot run code, so generated C++ is not compiled or tested.
- Calculator handles `+ - * / % ^` and brackets only.

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| Banner: *API key missing* | Edit `.env`, put your real key, save, restart `npm start` |
| *The Gemini API key was rejected* | Key typed wrongly or revoked: create a new one at aistudio.google.com/apikey |
| *Usage limit reached* | Wait a few minutes (or a day), or check quota in Google AI Studio |
| *Model is not available* | Set `GEMINI_MODEL` in `.env` to a model listed at ai.google.dev/gemini-api/docs/models |
| *Could not reach the Gemini service* | Check internet / proxy / firewall |
| `No C++ compiler found` | Install MSYS2 g++ (above) or set `CXX`. The website and AI still work; only calculator/Q&A notes are off |
| `Port 3000 is already in use` | `$env:PORT=3001; npm start` and open http://localhost:3001 |
| `Node.js 20 or newer is required` | Install the current LTS from nodejs.org |
| PowerShell blocks `npm` scripts | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt |

## 🔒 Security notes

- API key is read only on the server; `.env` is in `.gitignore`; the key is never logged or sent to the browser
- Server listens on `127.0.0.1` only, checks the `Host` header, sets a strict Content-Security-Policy
- Input is validated and size-limited; messages are collapsed to one line before reaching the C++ process, so they cannot inject commands
- AI output is rendered with safe DOM calls (no `innerHTML`); only `https` links are clickable
- AI-generated code is never executed

## 🎓 Viva tips

> **Viva Tip 1:** *Why C++ if Gemini answers?* The C++ engine does deterministic work (calculator, text-file search) and feeds notes to the AI; Node connects them.
>
> **Viva Tip 2:** *Why is the key in `.env`?* So it is never in source code or the browser and never committed to Git.
>
> **Viva Tip 3:** *How does the app talk to C++?* Node starts `ShahaneBot --server` once and exchanges one-line commands (`CALC`, `SEARCH`, `ASK`) and JSON replies over stdin/stdout.

### Demo prompts (all answered live, none hard-coded)

1. What is a constructor in C++?
2. Explain the difference between a constructor and a member function
3. Write a C++ program to reverse an array
4. Explain inheritance and polymorphism
5. Explain binary search and its time complexity
6. What causes rain?
7. Explain the quadratic equation x² - 5x + 6 = 0
8. What are the newest features of the latest C++ standard? Give sources. (turn **Web search** on)
9. `what is (3+4)*5` (answered by the C++ calculator)

## ✅ Manual test checklist

- [ ] `npm start` prints `Shahane GPT is running at http://localhost:3000`
- [ ] Status pill shows **AI + C++ ready**
- [ ] Enter sends, Shift+Enter makes a new line, Send button disabled while empty or busy
- [ ] A question not in the Q&A file (e.g. rain) gets an AI answer
- [ ] C++ code appears in a code block and **Copy** works
- [ ] Web search on + current-events question shows source chips (or an honest notice)
- [ ] Refresh keeps the chat; **Clear chat** then **Undo** works
- [ ] Wrong key in `.env` shows a readable error with **Retry**
