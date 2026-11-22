/* Attendigo in-app assistant: typed/voice guidance, no record mutations. */
(() => {
  'use strict';
  const library = window.AttendigoHelpTopics;
  if (!library || !window.attendigoStaffIdentity) return;
  const STAFF_ROLES = new Set(['TEACHER','DEPARTMENT_HEAD','SCHOOL_ADMIN','GATE_KEEPER','SUPER_ADMIN']);
  const hasSensitiveData = value => /\b\d{12}\b|\b09\d{9}\b|\+63[\s-]?9\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value);
  let user, open = false, busy = false, apiEnabled = false, lastFocus = null;
  let speaking = false, recognition = null, listening = false, abort = null;
  const $ = id => document.getElementById(id);
  const robotMarkup = () => '<span class="attendigo-help-robot" aria-hidden="true">'+
    '<i class="ah-antenna"></i><i class="ah-head"><i class="ah-face">'+
    '<i class="ah-eye ah-eye-left"></i><i class="ah-eye ah-eye-right"></i><i class="ah-mouth"></i>'+
    '</i></i><i class="ah-body"><i class="ah-book"></i></i><i class="ah-arm"></i></span>';
  const make = (tag, cls, value) => {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (value !== undefined) element.textContent = value;
    return element;
  };

  function allowedMenu(topic) {
    if (!topic?.nav) return null;
    const item = $(topic.nav);
    if (!item) return null;
    for (let parent = item; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.hidden && !parent.matches('.nav-submenu')) return null;
    }
    // Check actual role navigation, not a computed URL or a privileged endpoint.
    const nav = item.matches('.nav-item') ? item : item.querySelector('.nav-item');
    if (!nav && item.matches('.nav-group')) return null;
    if (nav && nav.hidden) return null;
    return nav || item;
  }
  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
  function stopListening() {
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    listening = false;
    const mic = $('attendigoHelpMic');
    if (mic) {
      mic.setAttribute('aria-pressed', 'false');
      mic.classList.remove('is-listening');
    }
  }
  function togglePanel(force) {
    open = typeof force === 'boolean' ? force : !open;
    const panel = $('attendigoHelpPanel'), trigger = $('attendigoHelpLauncher');
    if (!panel || !trigger) return;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('attendigo-help-open', open);
    if (open) {
      lastFocus = document.activeElement === trigger ? trigger : document.activeElement;
      $('attendigoHelpQuestion').focus({preventScroll:true});
    } else {
      abort?.abort();
      abort = null;
      stopListening();
      stopSpeech();
      if (lastFocus?.isConnected) lastFocus.focus({preventScroll:true});
      else trigger.focus({preventScroll:true});
    }
  }
  function setStatus(message, error = false) {
    const line = $('attendigoHelpStatus');
    if (line) { line.textContent = message; line.classList.toggle('is-error', error); }
  }
  function addMessage(kind, label) {
    const box = $('attendigoHelpMessages');
    const article = make('article', 'attendigo-help-msg attendigo-help-msg-' + kind);
    article.append(make('span', 'attendigo-help-msg-label', kind === 'user' ? 'You' : 'Attendigo Guide'));
    article.append(make('div', 'attendigo-help-msg-body', label));
    box.append(article);
    box.scrollTop = box.scrollHeight;
    return article;
  }
  function speakText(text) {
    if (!('speechSynthesis' in window)) {
      setStatus('Voice playback is not supported by this browser.');
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1150));
    utterance.lang = $('attendigoHelpLanguage').value === 'fil' ? 'fil-PH' : 'en-PH';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }
  function showAnswer(response, spoken = false, aiText = '') {
    const article = addMessage('assistant', response.title);
    const body = article.querySelector('.attendigo-help-msg-body');
    if (aiText) {
      body.textContent = aiText;
    } else {
      const list = make('ol', 'attendigo-help-steps');
      response.steps.forEach(step => list.append(make('li', '', step)));
      body.append(list);
      if (response.note) body.append(make('p', 'attendigo-help-note', response.note));
    }
    const menu = allowedMenu(response.topic);
    if (menu) {
      const button = make('button', 'attendigo-help-go', 'Open ' + (menu.querySelector('.nav-label')?.textContent?.trim() || response.topic.title));
      button.type = 'button';
      button.addEventListener('click', () => {
        // Re-evaluate at activation in case role/navigation permissions changed.
        const allowed = allowedMenu(response.topic);
        if (!allowed) { setStatus('This menu is not available for your account.', true); return; }
        togglePanel(false);
        allowed.click();
      });
      body.append(button);
    }
    const read = make('button', 'attendigo-help-read', '🔊 Read answer');
    read.type = 'button';
    read.setAttribute('aria-label', 'Read this answer aloud');
    read.addEventListener('click', () => speakText(aiText || [response.title, ...response.steps, response.note].filter(Boolean).join('. ')));
    body.append(read);
    $('attendigoHelpMessages').scrollTop = $('attendigoHelpMessages').scrollHeight;
    if (spoken) speakText(aiText || [response.title, ...response.steps].join('. '));
  }
  async function ask(raw, spoken = false) {
    const question = String(raw || '').trim().slice(0, 320);
    if (busy || !question) return;
    if (hasSensitiveData(question)) {
      setStatus('Please remove names, LRNs, phone numbers and email addresses before asking.', true);
      return;
    }
    addMessage('user', question);
    $('attendigoHelpQuestion').value = '';
    let response = library.answer(question, user.role);
    // A role may be generally eligible for a topic but lack the particular
    // designation or actual navigation link. Do not describe an unavailable
    // feature as if this account could use it.
    const unavailable = Boolean(response.topic?.nav && !allowedMenu(response.topic));
    if (unavailable) {
      response = {
        topic: null,
        title: 'This feature is not available to your account',
        steps: [
          'The requested feature is not visible in your current Attendigo navigation.',
          'Check that you have the required role, teaching designation, assigned class or active school year.',
          'Ask the School Admin to confirm your authorization. The guide cannot enable restricted features.'
        ],
        note: 'Do not try to open another user\'s tools through a direct URL.'
      };
    }
    busy = true;
    $('attendigoHelpSend').disabled = true;
    setStatus('Finding guidance…');
    let aiText = '';
    if (apiEnabled && response.topic && !unavailable && user.role !== 'SUPER_ADMIN') {
      abort = new AbortController();
      try {
        const result = await fetch('/api/help/ask', {
          method:'POST', credentials:'same-origin', cache:'no-store',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({question}),
          signal: abort.signal
        });
        const json = await result.json().catch(() => ({}));
        if (result.ok && typeof json.answer === 'string') aiText = json.answer.slice(0,2400);
        else if (result.status === 401) setStatus('Your session expired. Please sign in again.', true);
      } catch (error) {
        if (error.name === 'AbortError') { aiText = ''; }
      } finally { abort = null; }
    }
    if (open) showAnswer(response, spoken, aiText);
    busy = false;
    $('attendigoHelpSend').disabled = false;
    if (open) setStatus(aiText ? 'AI guidance · Always verify before submitting records' : 'Verified feature guide · Read-only help');
  }
  function startVoice() {
    if (listening) { stopListening(); setStatus('Voice input stopped.'); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setStatus('Voice questions are unavailable in this browser. You can type instead.', true); return; }
    stopSpeech();
    recognition = new SpeechRecognition();
    recognition.lang = $('attendigoHelpLanguage').value === 'fil' ? 'fil-PH' : 'en-PH';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript.trim()) ask(transcript, true);
    };
    recognition.onerror = event => {
      const detail = event.error === 'not-allowed' ? 'Microphone access was denied. Type your question instead.' : 'Voice input could not hear clearly. Please try typing.';
      setStatus(detail, true);
    };
    recognition.onend = () => {
      listening = false;
      recognition = null;
      $('attendigoHelpMic')?.setAttribute('aria-pressed','false');
      $('attendigoHelpMic')?.classList.remove('is-listening');
    };
    try {
      recognition.start();
      listening = true;
      $('attendigoHelpMic').setAttribute('aria-pressed','true');
      $('attendigoHelpMic').classList.add('is-listening');
      setStatus('Listening… Please speak your Attendigo question.');
    } catch {
      stopListening();
      setStatus('Could not start voice input. Please type instead.', true);
    }
  }
  async function checkAI() {
    if (user.role === 'SUPER_ADMIN') return;
    try {
      const res = await fetch('/api/help/config', {credentials:'same-origin',cache:'no-store'});
      if (!res.ok) return;
      const data = await res.json();
      apiEnabled = Boolean(data.aiEnabled);
      const disclosure = $('attendigoHelpDisclosure');
      if (disclosure) disclosure.textContent = apiEnabled
        ? 'AI-enabled questions are sent to the configured AI provider. Do not enter personal or confidential information.'
        : 'Built-in guide. No teacher or learner records are sent to an AI service.';
    } catch { /* The built-in, offline-friendly guide always remains available. */ }
  }
  function init(identity) {
    user = identity;
    if (!STAFF_ROLES.has(user?.role) || $('attendigoHelpLauncher')) return;
    const launcher = make('button', 'attendigo-help-launcher');
    launcher.innerHTML = robotMarkup() + '<span class="attendigo-help-label">Ask Attendigo</span>';
    launcher.id = 'attendigoHelpLauncher';
    launcher.type = 'button';
    launcher.setAttribute('aria-controls', 'attendigoHelpPanel');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.title = 'Ask Attendigo for help';
    const panel = make('section', 'attendigo-help-panel');
    panel.id = 'attendigoHelpPanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Attendigo help assistant');
    panel.innerHTML = `
      <div class="attendigo-help-header">
        <div class="attendigo-help-brand">${robotMarkup()}<span><strong>Attendigo Guide</strong><small>Your in-app teacher assistant</small></span></div>
        <button id="attendigoHelpClose" type="button" aria-label="Close help assistant">×</button>
      </div>
      <div class="attendigo-help-messages" id="attendigoHelpMessages" aria-label="Help conversation" aria-live="polite" aria-relevant="additions"></div>
      <div class="attendigo-help-suggestions" id="attendigoHelpSuggestions" aria-label="Suggested questions"></div>
      <form class="attendigo-help-form" id="attendigoHelpForm">
        <label for="attendigoHelpQuestion">Ask how to use Attendigo</label>
        <textarea id="attendigoHelpQuestion" rows="2" maxlength="320" placeholder="e.g. How do I import SF1?" required></textarea>
        <div class="attendigo-help-controls">
          <select id="attendigoHelpLanguage" aria-label="Voice language"><option value="en">English</option><option value="fil">Filipino</option></select>
          <button id="attendigoHelpMic" type="button" aria-label="Ask by voice" aria-pressed="false" title="Voice question">🎙</button>
          <button id="attendigoHelpSend" type="submit">Ask</button>
        </div>
      </form>
      <p class="attendigo-help-status" id="attendigoHelpStatus" role="status" aria-live="polite">Guidance only · No records are modified</p>
      <p class="attendigo-help-disclosure" id="attendigoHelpDisclosure">Built-in guide. Do not share personal details, passwords or private codes.</p>`;
    // Keep the primary header uncluttered. Dock Help & Support in the existing
    // sidebar, after the main navigation so it works for every staff role.
    // The dock stays in normal sidebar flow: it never covers dashboard actions.
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const dock = make('div', 'attendigo-help-dock');
    dock.id = 'attendigoHelpDock';
    dock.setAttribute('role', 'complementary');
    dock.setAttribute('aria-label', 'Help and Support');
    dock.append(make('span', 'attendigo-help-dock-title', 'HELP & SUPPORT'));
    dock.append(launcher);
    sidebar.append(dock);
    document.body.append(panel);
    launcher.addEventListener('click', () => {
      // A phone/tablet sidebar is a temporary drawer. Close it first so the
      // help conversation is visible and its question field receives focus.
      if (sidebar.classList.contains('open')) {
        document.getElementById('sidebarBackdrop')?.click();
      }
      togglePanel();
    });
    $('attendigoHelpClose').addEventListener('click', () => togglePanel(false));
    $('attendigoHelpForm').addEventListener('submit', event => { event.preventDefault(); ask($('attendigoHelpQuestion').value); });
    $('attendigoHelpQuestion').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        ask($('attendigoHelpQuestion').value);
      }
    });
    $('attendigoHelpMic').addEventListener('click', startVoice);
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      $('attendigoHelpMic').disabled = true;
      $('attendigoHelpMic').title = 'Voice recognition unavailable. Use the text box.';
    }
    document.addEventListener('keydown', event => {
      if (open && event.key === 'Escape') { event.preventDefault(); togglePanel(false); }
    });
    const greeting = user.role === 'TEACHER'
      ? 'Hello! Ask me about class attendance, SF1, schedules, OB, leave or your DTR. I can guide you one step at a time.'
      : 'Hello! Ask me how to find or use Attendigo features available to your role.';
    addMessage('assistant', greeting);
    const suggestions = $('attendigoHelpSuggestions');
    const picks = user.role === 'TEACHER'
      ? ['class-attendance','sf1-import','dtr','leave','official-business','schedule']
      : user.role === 'GATE_KEEPER' ? ['gate-scan','technical','navigation']
      : ['schedule','teacher-assignment','sf2','leave','technical'];
    const topics = library.forRole(user.role);
    picks.map(id => topics.find(topic => topic.id === id)).filter(Boolean).forEach(topic => {
      const chip = make('button', 'attendigo-help-chip', topic.title);
      chip.type = 'button';
      chip.addEventListener('click', () => ask(topic.title));
      suggestions.append(chip);
    });
    checkAI();
  }
  window.attendigoStaffIdentity.then(init).catch(() => {});
})();
