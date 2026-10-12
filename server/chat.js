const { AiError } = require('./ai');

const FILLER = /\b(what|whats|what's|is|are|the|calculate|compute|evaluate|solve|find|value|of|result|equals|equal|please|tell|me)\b/g;
const WORD_OPERATORS = /\b(plus|minus|times|multiplied by|divided by|over|modulo|mod|to the power of|raised to|power)\b/g;
const CURRENT_INFO = /\b(latest|current|currently|today|tonight|right now|recent|recently|news|this (week|month|year)|20(2[4-9]|3\d)|price of|stock|weather|score|release date|new version|who won|election|trending|breaking)\b/i;
const CPP_TOPIC = /(c\+\+|\bcpp\b|\bpointers?\b|\bconstructors?\b|\bdestructors?\b|\bclass(es)?\b|\binheritance\b|\bpolymorphism\b|\btemplates?\b|\bstl\b|\bvector\b|\bvirtual\b|\bnamespace\b|\biostream\b|\boop\b)/i;
const LOCAL_FALLBACK_CODES = new Set(['missing-key', 'network', 'quota', 'timeout', 'unavailable']);

function isPureCalculation(message) {
  if (message.length > 100) return false;
  const stripped = message
    .toLowerCase()
    .replace(WORD_OPERATORS, ' + ')
    .replace(FILLER, ' ')
    .replace(/[?=]/g, ' ');
  return /\d/.test(stripped) && /^[\d\s.+\-*/%^()x×÷]*$/.test(stripped);
}

function referenceLinks(message) {
  if (!CPP_TOPIC.test(message)) return [];
  return [
    { title: 'cppreference.com (C++ reference)', url: 'https://en.cppreference.com/', kind: 'reference' },
    { title: 'LearnCpp.com (C++ tutorial)', url: 'https://www.learncpp.com/', kind: 'reference' }
  ];
}

function searchLink(message) {
  return {
    title: 'Search Google for this question',
    url: 'https://www.google.com/search?q=' + encodeURIComponent(message.slice(0, 200)),
    kind: 'search'
  };
}

function shouldSearch(config, requested, message) {
  if (config.grounding === 'off') return false;
  if (config.grounding === 'on') return true;
  return requested === true || CURRENT_INFO.test(message);
}

function createChat({ config, engine, ai }) {
  let storedQuestions = null;

  async function exactStoredAnswer(message) {
    if (!storedQuestions) {
      const list = await engine.listQuestions();
      storedQuestions = new Set(list.map((q) => q.trim().toLowerCase()));
    }
    if (!storedQuestions.has(message.trim().toLowerCase())) return null;
    const reply = await engine.ask(message);
    return reply && reply.found === true ? reply.answer : null;
  }

  async function safeEngine(fn) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[chat] C++ engine unavailable: ${err.message}`);
      return null;
    }
  }

  return async function handleChat({ message, history, webSearch }) {
    if (isPureCalculation(message)) {
      const answer = await safeEngine(() => engine.calculate(message));
      if (answer) {
        return { answer, sources: [], grounded: false, via: 'cpp-calculator', notice: null, model: null };
      }
    }

    const notes = (await safeEngine(() => engine.search(message, 3))) || [];
    const usefulNotes = notes.filter((n) => n.coverage >= 0.5).slice(0, 3);
    const useSearch = shouldSearch(config, webSearch, message);

    try {
      const result = await ai.generate({ message, history, notes: usefulNotes, useSearch });
      const sources = [...result.sources, ...referenceLinks(message)];
      const grounded = result.sources.length > 0;
      let notice = result.groundingNote || null;

      if (useSearch && !result.groundingNote && !grounded) {
        notice = 'Web search ran but returned no source links for this answer.';
      }
      if (useSearch && !grounded) sources.push(searchLink(message));

      return {
        answer: result.text,
        sources,
        grounded,
        via: 'gemini',
        notice,
        model: config.model,
        notesUsed: usefulNotes.length
      };
    } catch (err) {
      const best = notes.find((n) => n.coverage >= 0.99);
      const canFallBack = err instanceof AiError && LOCAL_FALLBACK_CODES.has(err.code);
      const localAnswer = canFallBack ? (best ? best.answer : await safeEngine(() => exactStoredAnswer(message))) : null;
      if (localAnswer) {
        return {
          answer: localAnswer,
          sources: referenceLinks(message),
          grounded: false,
          via: 'local-fallback',
          notice: `${err.message} This answer comes from the local C++ question file instead.`,
          model: null
        };
      }
      throw err;
    }
  };
}

module.exports = { createChat, isPureCalculation, shouldSearch };
