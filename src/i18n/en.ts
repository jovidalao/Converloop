// English UI strings — the source of truth for the message key shape. Every
// other locale (see zh.ts) must provide the same keys, enforced by `Messages`.
export const en = {
  common: {
    edit: "Edit",
    delete: "Delete",
    rename: "Rename",
    cancel: "Cancel",
    save: "Save",
    back: "Back",
    close: "Close",
    confirm: "Confirm",
    retry: "Retry",
    loading: "Loading…",
    loadFailed: "Failed to load",
    copy: "Copy",
    details: "Details",
  },
  errorBoundary: {
    title: "Something went wrong",
    reload: "Reload",
  },
  // User-facing errors thrown outside React (orchestrator / background runners).
  errors: {
    missingApiKey:
      "No API key configured, please fill it in on the settings page",
    lessonOnly:
      "Only focused-lesson sessions can confirm lesson mastery signals",
    lessonNoAgent: "This focused lesson has no learning agent linked",
    agentNotFound: "Learning agent not found",
    lessonTurnNotFound: "Focused-lesson turn not found",
    regenerateTurnNotFound: "Reply to regenerate not found",
    suggestionTurnNotFound: "Message for reply suggestion not found",
    lessonNotLearnerOutput:
      "This turn is not learner output; nothing was written.",
    lessonNoWriteback: "No learning items to write back.",
    maintainerNoKey: "No API key configured",
    maintainerRunning: "Maintenance job already running",
    sttNoProvider:
      "No speech-to-text provider selected. Choose one in Settings → Voice input.",
    sttNoKey:
      "No speech-to-text key configured. Add one in Settings → Voice input.",
    ttsNoKey:
      "Please configure the MiMo API key in Settings → Text-to-Speech first.",
    requestAuth:
      "Provider authentication failed. Check the API key or sign in again.",
    requestQuota:
      "The provider refused the request because of quota or rate limits.",
    requestTimeout: "The provider request timed out. Try again in a moment.",
    requestNetwork:
      "Network request failed. Check your connection or provider base URL.",
    requestFailed: "The provider request failed.",
  },
  speak: {
    play: "Read aloud",
    stop: "Stop reading",
  },
  stt: {
    startRecording: "Voice input (speak, then click again to finish)",
    stopRecording: "Finish voice input (Esc to cancel)",
    noProvider:
      "Voice input is disabled until you choose an STT provider in Settings → Voice input.",
    micDenied:
      "Microphone unavailable — check the system microphone permission for lang-agent.",
  },
  onboarding: {
    title: "Welcome to lang-agent",
    subtitleLanguages:
      "Tell the coach who's learning what — you can change any of this later in Settings.",
    subtitleProvider:
      "Connect one AI model to power conversations and corrections. Your key stays on this device.",
    provider: "Model provider",
    keyPlaceholder: "Paste your {provider} API key",
    saveAndTest: "Save key & test connection",
    testOk: "Connected — the model replied “{sample}”.",
    loginOk: "Signed in. Subscription token saved.",
    noCredential: "No key or login found for this provider yet.",
    next: "Next",
    finish: "Start learning",
    skip: "Skip for now",
  },
  slashMenu: {
    ariaLabel: "Slash commands",
    customBadge: "custom",
    editedBadge: "edited",
    customize: "Customize commands…",
    bodyMissing: "Type your input, then press Enter",
  },
  // Localized menu text for the built-in slash commands (commands.ts). Prompt-macro entries only
  // show these until the user overrides the text in settings — then their text wins as-is.
  slashCommands: {
    btw: "Standalone side question: excluded from context and grading",
    btwHint: "<ask the AI anything>",
    topic: "Switch the conversation to a topic",
    topicHint: "<topic>",
    roleplay: "Role-play a scenario in this conversation",
    roleplayHint: "<scenario>",
    learn: "Learn a topic through conversation",
    learnHint: "<what to learn>",
    surprise: "Start chatting about a random topic",
    how: "Ask how to say something in the target language",
    howHint: "<what you want to say>",
    recap: "Recap this conversation: takeaways and what to review",
    harder:
      "Increase difficulty: branch into a harder version of the current conversation",
    easier: "Decrease difficulty: branch into an easier version",
    swap: "Swap roles: branch into a role-reversed version",
    scene: "Change scene: keep the practice goal, switch the setting",
    restart: "Restart: keep the setup, open a blank branch for re-practice",
    nextDay:
      "Continue next day: branch into a new-day continuation of the current story",
  },
  turnActivity: {
    thinking: "Thinking…",
    processing0: "Composing a reply…",
    processing1: "Matching learning focus…",
    processing2: "Preparing correction cues…",
    elapsedSeconds: "{n} seconds",
  },
  replyExplanation: {
    explain: "Explain",
    explainTooltip: "Explain this reply based on what you've mastered",
  },
  annotationIsland: {
    ariaLabel: "Selection learning actions",
    analyze: "Analyze",
    speak: "Read aloud",
    add: "Add",
    analyzing: "Analyzing…",
    selectTextHint: "Please select content that contains text or numbers",
    added: "Added to learning data: {label}",
    previewTitle: "Preview learning item",
    confirmAdd: "Add item",
    saving: "Saving…",
  },
  corrections: {
    category: {
      grammar: "Grammar",
      word_choice: "Word choice",
      collocation: "Collocation",
      spelling: "Spelling",
      punctuation: "Punctuation",
      register: "Register",
      naturalness: "Naturalness",
    },
    severity: {
      minor: "Minor",
      moderate: "Moderate",
      major: "Major",
    },
    nativeInputTitle: "Native-language / mixed input",
    nativeFallback: "Native",
    analyzing: "Analyzing…",
    correct: "Looks correct",
    noChanges: "No corrections needed",
    unavailable: "Correction unavailable",
    explain: "Explain",
    languageCorrection: "Language correction",
    correctedSentence: "Corrected sentence",
    naturalExpression: "Natural expression",
    expressionTemplate: "Reusable pattern",
    grammarDetails: "Grammar details",
    explanationHeader: "Explanation",
    keyItems: "Key words / patterns",
    degraded:
      "Correction fell back to plain text this turn; not recorded in mastery",
    showDiagnostic: "Show diagnostics",
    hideDiagnostic: "Hide diagnostics",
  },
  learningAgentDialog: {
    editAria: "Edit lesson {name}",
    title: "Edit lesson",
    builtIn: "Built-in lesson",
    custom: "Custom lesson",
  },
  coach: {
    title: "Learning coach",
    waitingInput: "Waiting for input",
    wholeConversationSub: "Whole conversation · {n} turns",
    emptyHint:
      "Once you start chatting, this shows a turn-by-turn review of the conversation and the learning memory recorded for you.",
    signal: {
      error: "Marked wrong",
      correct: "Used correctly",
      introduced: "Newly introduced",
      gap: "Expression gap",
    },
    type: {
      vocab: "Vocabulary",
      grammar: "Grammar",
      collocation: "Collocation",
      error_pattern: "Error pattern",
      expression_gap: "Expression gap",
    },
    conversationObservationsEmpty:
      "No custom observations in this conversation yet.",
    applied: "Applied {n} items.",
    noProposalsHint: "No write suggestions to confirm.",
    confirmWrite: "Confirm write",
    dismiss: "Dismiss",
    proposal: {
      create: "Add to learning data: {label}",
      update: "Update: {label}",
      delete: "Remove: {label}",
      merge: "Merge {label} → {target}",
    },
    badge: {
      grading: "Grading",
      graded: "Graded",
      failed: "Grading failed",
      notGraded: "Not graded",
      gap: "Expression gap",
      issues: "{n} issues",
      accurate: "Accurate",
    },
    stats: {
      practiceTurns: "Practice turns",
      accurate: "Accurate",
      toImprove: "To improve",
      memory: "Learning memory",
    },
    dueReview: {
      title: "Due for review",
      subtitle:
        "Retention on these has dropped — the AI is nudged to weave them back into the conversation naturally.",
      empty: "Nothing is due for review right now.",
      retention: "retention {p}%",
    },
    reviewTitle: "Turn-by-turn review",
    conversationMemoryTitle: "Conversation learning memory",
    conversationMemoryEmpty: "No learning recorded for this conversation yet.",
    pendingMemoryTitle: "Pending memory",
    observationsTitle: "Custom observations",
    emptyTurnText: "(empty)",
    viewAllData: "View all learning data",
    hints: {
      title: "A way to keep going",
      empty:
        "Once a reply comes in, this shows one ready-to-borrow way to keep the conversation going.",
      regenerate: "Try another",
      regenerating: "Finding another…",
      use: "Use this opener",
    },
  },
  logs: {
    title: "Logs",
    description:
      "A record of every agent run — conversation, task planning, profile maintenance, summaries, and manual runs — filterable by source and status.",
    allSources: "All sources",
    allStatuses: "All statuses",
    refresh: "Refresh",
    empty: "No runs match these filters.",
    pageInfo: "Page {page} / {pages} · {total} items",
    prev: "Previous",
    next: "Next",
    source: {
      conversation: "Conversation",
      task_agent: "Task planning",
      maintainer: "Profile maintenance",
      summary: "Summary",
      manual: "Manual",
    },
    status: {
      succeeded: "Succeeded",
      failed: "Failed",
      running: "Running",
      pending: "Pending",
    },
  },
  learningAgents: {
    title: "Create lesson",
    description:
      'A "lesson" opens a new conversation with a teacher-style system prompt; it can explain in your native language or drill in your target language. After creating it, it appears in Practice Center, where you can start or edit it.',
    projectTitle: "Learning project",
    projectPlaceholder:
      "e.g. I have a frontend job interview in English next month — help me build a practice plan.",
    planning: "Planning…",
    generateProject: "Generate project",
    existingProjects: "Existing learning projects",
    nextActions: "Next actions",
    generatedLessons: "Generated lessons: {lessons}",
    projectLessons: "Project lessons",
    lessonProgress: "{done}/{total} lessons done",
    markLessonDone: "Mark lesson done",
    markLessonUndone: "Mark lesson not done",
    startLesson: "Start",
    statusActive: "Active",
    statusCompleted: "Completed",
    statusArchived: "Archived",
    projectStatusUpdated: "Project status updated.",
    packageSection: "Import / export lessons",
    packageNote:
      "A share package only contains the prompt, permissions, and lesson structure — not your learning data, conversation history, or keys.",
    export: "Export",
    packagePlaceholder:
      "Paste lang-agent.package JSON. Exported packages also appear here.",
    packageSummary: "{summary} · Reads: {reads} · Writes: {writes}",
    importing: "Importing…",
    importPackage: "Import package",
    importConfirmTitle: 'Import "{name}"?',
    importConfirmDesc:
      "{summary}. Runtime skills are imported disabled by default; lessons are available after import.",
    importEnabled: "Enabled after import",
    importDisabled: "Imported disabled by default",
    nlCreate: "Create from natural language",
    lessonPlaceholder:
      "e.g. Create a teacher that drills business email openings and closings, generating exercises from my expression gaps.",
    creating: "Creating…",
    autoCreate: "Auto-create",
    projectCreated: "Created a learning project and generated {n} lessons.",
    lessonCreated:
      "Lesson created. It's been added to Practice Center — start it directly or edit it there.",
    exported: 'Exported to the package text box under "Import / export" below.',
    imported: "Package imported: {lessons} lessons, {skills} skills.",
  },
  sidebar: {
    justNow: "just now",
    newChat: "New chat",
    newChatTooltip: "New chat {shortcut}",
    today: "Today's training",
    todayTooltip:
      "Your daily playlist: what to practice today, built from your records",
    quickfire: "Scenario drills",
    quickfireTooltip:
      "Scenario drills: set one scenario, handle the concrete situations it throws at you",
    dictation: "Dictation",
    dictationTooltip:
      "Dictation drill: listen to a sentence and type exactly what you hear",
    shadowing: "Read aloud",
    shadowingTooltip:
      "Shadowing drill: listen to a model sentence and read it aloud",
    reviewDrill: "Weak-spot drill",
    reviewDrillTooltip:
      "Active retrieval: micro-tasks that make you produce your due-for-review items",
    customLearning: "Practice Center",
    customLearningTooltip: "Start built-in drills or browse focused lessons",
    group: {
      pinned: "Pinned",
      today: "Today",
      week: "This week",
      earlier: "Earlier",
    },
    pin: "Pin",
    unpin: "Unpin",
    noConversations: "No conversations yet",
    settings: "Settings",
    settingsTooltip: "Settings {shortcut}",
    back: "Back",
    deriveNewConversation: "Derive new conversation",
    resizeTooltip: "Drag to resize",
    sectionSettings: "Settings",
    sectionProfileDatabase: "Profile database",
    general: "General",
    customization: "Customization",
    llmProviders: "LLM providers",
    sttProviders: "Voice input",
    ttsProviders: "TTS providers",
    slashCommands: "Slash commands",
    designNotes: "Design notes",
    data: "Data",
    capabilities: "Capabilities",
    logs: "Logs",
    profile: "Profile",
    deleteLessonTitle: 'Delete lesson "{name}"?',
    deleteLessonDescription: "Existing conversations won't be deleted.",
    deleteConversationTitle: 'Delete conversation "{title}"?',
    deleteConversationDescription: "This action cannot be undone.",
  },
  quickfire: {
    startTitle: "Scenario drills",
    startDescription:
      "Give me a scenario and I'll throw concrete situations at you to handle — take your time, check your corrections, and a quick model answer comes before the next one.",
    recommendedTopics: "Recommended topics",
    scenarioPlaceholder: "Describe a scenario… or pick one above",
    refresh: "Regenerate",
  },
  shadowing: {
    startTitle: "Read aloud",
    startDescription:
      "Pick a theme and I'll show a sentence and read it to you — read it aloud yourself, and I'll point out the words that didn't come through.",
    recommendedTopics: "Recommended themes",
    themePlaceholder: "Describe a theme… or pick one above",
    attemptPlaceholder: "Use the mic to read the sentence aloud…",
    readPrompt: "Listen to the model, then read this sentence aloud",
    refresh: "Regenerate",
  },
  reviewDrill: {
    startTitle: "Weak-spot drill",
    startDescription:
      "I'll pick the items most worth reviewing right now and design micro-tasks that make you produce each one from memory — the fastest way to make them stick.",
    itemsLabel: "Up for review",
    empty:
      "Nothing is due for review right now. Chat or practice a bit more, then come back.",
    start: "Start drill",
    startHint: "Press “Start drill” above to begin",
  },
  drillReport: {
    button: "Session report",
    generating: "Writing the session report…",
    title: "Session report",
  },
  drillDialog: {
    createTitle: "New training mode",
    editTitle: "Edit training mode",
    subtitle:
      "A training mode is one Markdown document: frontmatter for the mechanics, sections for the prompts.",
    describePlaceholder:
      'Describe the training you want, e.g. "give me native-language sentences to translate aloud"…',
    generate: "Generate with AI",
    generateInvalid:
      "The generated document failed validation — see the errors below and fix or regenerate.",
    externalHint:
      "Prefer your own AI? Copy the authoring guide, paste it into ChatGPT/Claude with your idea, then paste the result here.",
    copySpec: "Copy AI authoring guide",
    specCopied: "Copied",
    documentPlaceholder:
      "Paste or write a lang-agent/drill@1 Markdown document…",
    errorsTitle: "The document failed validation",
    errorsHint:
      "Tip: paste these errors back to the AI that wrote the document and ask it to fix them.",
    validSummary: "Valid: “{name}” · interaction: {interaction}",
  },
  drill: {
    start: "Start",
    startHint: "Use the Start button above to begin",
    recommendedTopics: "Recommended topics",
    refresh: "Regenerate",
    themePlaceholder: "Describe a topic… or pick one above",
  },
  newChat: {
    greetingMorning: "Good morning — warm up with a sentence or two?",
    greetingAfternoon: "Good afternoon — a few sentences to reset?",
    greetingEvening: "Good evening — wind down with some practice?",
    greetingNight: "Up late? Even one sentence counts.",
    recommendedTopics: "Recommended topics",
    refresh: "Regenerate",
    providerLlm: "Model",
    providerTts: "Speech",
    providerStt: "Voice input",
    providerNotSet: "Not set",
    providerLocal: "On-device",
    ttsEdge: "Microsoft Edge",
    ttsMimo: "MiMo",
    sttSoniox: "Soniox",
    sttOpenai: "OpenAI compatible",
    sttParakeet: "Parakeet V3",
    sttQwen3: "Qwen3-ASR",
  },
  dictation: {
    startTitle: "Dictation",
    startDescription:
      "Pick a theme and I'll read out sentences one at a time — type exactly what you hear, then I'll mark it and explain what you missed.",
    recommendedTopics: "Recommended themes",
    themePlaceholder: "Describe a theme… or pick one above",
    transcriptionPlaceholder: "Type what you hear…",
    awaitingEnterPlaceholder: "Press Enter or tap “Next question” to continue…",
    listenPrompt: "Listen and type what you hear",
    nextQuestion: "Next question",
    replay: "Replay",
    slowReplay: "Replay slowly",
    refresh: "Regenerate",
  },
  customLearning: {
    newDrill: "New training mode",
    duplicateDrill: "Duplicate as my training mode",
    exportDrill: "Copy document (.md)",
    deleteDrillTitle: "Delete training mode “{name}”?",
    deleteDrillDescription:
      "The training mode document will be deleted. Existing sessions keep working from their snapshot.",
    title: "Practice Center",
    description:
      "Start a built-in drill or pick a focused lesson to preview it before starting. Everything here opens a practice session built around your learning data.",
    manage: "Create / manage",
    drillsLabel: "Built-in drills",
    reviewDrillTitle: "Weak-spot drill",
    reviewDrillDesc:
      "Review the items most worth practicing right now through quick production tasks.",
    dictationTitle: "Dictation",
    dictationDesc:
      "Listen to adaptive sentences and type exactly what you hear.",
    shadowingTitle: "Read aloud",
    shadowingDesc:
      "Hear a model sentence, read it aloud, and compare the transcript.",
    quickfireTitle: "Scenario drills",
    quickfireDesc:
      "Practice responding inside concrete situations that pull in review items.",
    lessonsLabel: "Focused lessons",
    empty: "No lessons yet. Create one from the button above.",
    previewHint: "Review this lesson before starting a new session.",
    startLesson: "Start lesson",
  },
  practiceStats: {
    overview: "Overview",
    trend: "Trend",
    mastery: "Knowledge points",
    sentencesToday: "Today",
    sentencesTotal: "Total sentences",
    activeDays: "Active days",
    currentStreak: "Current streak",
    mastered: "Mastered",
    learning: "Learning",
    struggling: "Struggling",
    days: "{n}d",
    dayTooltip: "{count} sentences · {date}",
    progressSoFar: "{n} sentences practiced today — keep it going.",
    progressNone: "Nothing yet today. Ten focused minutes is plenty.",
    trendEmpty: "No practice in the last 14 days.",
    masteryEmpty: "No knowledge points tracked yet.",
  },
  lessonReview: {
    reviewButton: "Review session & record mastery",
    reviewing: "Reviewing the session…",
    previewTitle: "Session review: items you demonstrated",
    apply: "Write {n} evidence item(s)",
  },
  commandPalette: {
    ariaLabel: "Quick jump",
    searchPlaceholder: "Search conversations, lessons…",
    noResults: "No matching results",
    practiceModes: "Practice modes",
    customLessons: "Custom lessons",
    recentConversations: "Recent conversations",
    newChat: "New chat",
    startNewSession: "Start a new session",
  },
  app: {
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
    back: "Back",
    forward: "Forward",
    newChat: "New chat",
    quickfire: "Scenario drills",
    dictation: "Dictation",
    shadowing: "Read aloud",
    reviewDrill: "Weak-spot drill",
    search: "Search",
    deriveNewConversation: "Derive new conversation",
    deriving: "Generating…",
    deriveTooltip: "Generate a new conversation context from the current chat",
    showCoach: "Show coach panel",
    hideCoach: "Hide coach panel",
    deriveFailed: "Failed to derive conversation: {error}",
    customLearningFallback: "Practice Center",
    smallWindow: "Small window",
    exitSmallWindow: "Exit small window",
  },
  actions: {
    "new-chat": "New chat",
    "command-palette": "Search conversations and lessons",
    "navigate-back": "Go back",
    "navigate-forward": "Go forward",
    "toggle-sidebar": "Show / hide sidebar",
    settings: "Open settings",
    "focus-sidebar": "Focus sidebar",
    "focus-chat": "Focus chat input",
    "focus-coach": "Focus coach panel",
    shortcuts: "Show shortcuts",
    "slash-command": "Type a command",
    dismiss: "Close menu or dialog",
  },
  shortcutsDialog: {
    ariaLabel: "Keyboard shortcuts",
    title: "Keyboard shortcuts",
    subtitle: "Common actions can all be done from the keyboard.",
  },
  viewTitles: {
    today: "Today's training",
    profile: "Learner profile",
    mastery: "Learning data",
    learning: "Create lesson",
    customLearning: "Practice Center",
    design: "Design notes",
    agents: "Capabilities",
    logs: "Logs",
    general: "General settings",
    customize: "Customization",
    llm: "LLM providers",
    stt: "Voice input",
    tts: "TTS providers",
    commands: "Slash commands",
  },
  settings: {
    general: {
      title: "General settings",
      description:
        "Adjust the app's appearance and learning languages. Changes here are saved locally right away.",
      theme: "Theme",
      accent: "Accent color",
      interfaceLanguage: "Interface language",
      nativeLanguage: "Native language",
      targetLanguage: "Target language",
      level: "Level",
      autoBilingual:
        "Auto-open bilingual reading for AI replies (sentence by sentence)",
      actionLabels: "Show text labels on chat action buttons",
      inputHintsAuto:
        "Auto reply hints each turn (generated along with the reply, usually no extra call)",
      glass: "Enable macOS glass effect",
    },
    backup: {
      exportLabel: "Export learning data",
      exportButton: "Export backup",
      exporting: "Exporting…",
      exported: "Backup saved to {path}",
      importLabel: "Restore from a backup",
      importButton: "Import backup",
      importing: "Importing…",
      imported: "Backup restored. Reloading…",
      importConfirmTitle: "Replace all learning data?",
      importConfirmDesc:
        "This restores the backup ({conversations} conversations · {turns} turns · {masteryItems} learning items, exported {date}) and OVERWRITES everything currently in the app. This cannot be undone.",
      note: "The backup is one readable JSON file: conversations, learning data, your profile, and settings. API keys and login tokens are never included.",
    },
    shortcuts: {
      title: "Keyboard shortcuts",
      description:
        "Click Edit, then press a new key combination. A modifier (⌘, ⌃, or ⌥) is required; Esc cancels.",
      edit: "Edit",
      recording: "Press keys…",
      reset: "Reset",
      resetAll: "Reset all",
      needModifier: "Add a modifier key (⌘, ⌃, or ⌥).",
      conflict: "Already used by “{action}”.",
    },
    themes: { light: "Light", dark: "Dark", system: "System" },
    accents: {
      gray: "Gray",
      blue: "Blue",
      purple: "Purple",
      claude: "Claude orange",
    },
    languages: { en: "English", zh: "中文" },
    card: {
      inUse: "In use",
      use: "Use",
    },
    llm: {
      title: "LLM providers",
      description:
        'All providers are listed below; each can be configured and saved independently. Open any one to edit its connection info — the "Use" button decides which one chat actually uses.',
      model: "Model",
      customModelOption: "{label} · Custom model",
      customModelId: "Custom model ID",
      modelId: "Model ID: {id}",
      contextWindow:
        "Context window (tokens · leave blank to infer from the model)",
      contextAuto: "Auto: {n}",
      jsonObjectFallback: "Degrade to JSON object mode",
      jsonObjectFallbackHint:
        "For endpoints that don't support response_format json_schema (DeepSeek / Qwen / Kimi / GLM / MiniMax and similar): the schema is added to the prompt and the reply is parsed leniently. On by default for providers known to lack it.",
      apiKeyLabel: "API key {state}",
      apiKeyStateSaved: "(saved · leave blank to keep)",
      apiKeyStateUnset: "(not set)",
      keyStorageNote:
        "Stored in a device-bound encrypted file (no master password — protects against casual reads, not someone with full disk access). Never sent anywhere except the provider.",
      saveKey: "Save key",
      clear: "Clear",
      testing: "Testing…",
      testConnection: "Test connection (streaming + non-streaming)",
      restorePreset: "Restore preset",
      statusSignedIn: "Signed in · subscription token",
      statusSignedOut: "Not signed in · browser subscription login required",
      statusKeySaved: "API key saved",
      statusKeyUnset: "No API key set",
      keySaved: "API key encrypted and saved locally.",
      keyCleared: "API key cleared from local storage.",
      loginSuccess: "✓ Signed in. Token encrypted and saved locally.",
      loginFailed: "✗ Login failed: {error}",
      loggedOut: "Signed out; token cleared.",
      noSubscription: "This provider doesn't support subscription login yet.",
      testNoCredential: "No API key / not signed in yet.",
      testOk:
        '✓ Connection OK — non-streaming: "{sample}" | streaming received {count} chars',
      modelAdded: "“{model}” added to the model list.",
      testFailed: "✗ Failed: {error}",
      subscriptionLogin: "Subscription login {state}",
      stateSignedIn: "· signed in",
      stateSignedOut: "· not signed in",
      waitingBrowser: "Waiting for browser authorization…",
      reLogin: "Sign in again",
      loginWithBrowser: "Sign in with browser",
      logout: "Sign out",
      tokenRefresh: "The access token will auto-refresh before {date}.",
      subscriptionWarning:
        "⚠️ Using subscription tokens (claude.ai / ChatGPT) in third-party apps may violate the relevant terms of service and risk your account being flagged; for your own account, proceed at your own discretion.",
    },
    baseUrl: {
      openai: "Base URL (OpenAI-compatible)",
      gemini: "Base URL (Gemini native API)",
      anthropic: "Base URL (Anthropic)",
      deepseek: "Base URL (DeepSeek)",
      openrouter: "Base URL (OpenRouter)",
      xai: "Base URL (xAI Grok)",
      mistral: "Base URL (Mistral)",
      qwen: "Base URL (Qwen / DashScope)",
      moonshot: "Base URL (Moonshot / Kimi)",
      glm: "Base URL (Zhipu GLM)",
      minimax: "Base URL (MiniMax)",
      "claude-oauth": "Base URL (Anthropic official)",
      "codex-oauth": "Base URL (ChatGPT Codex backend)",
    },
    stt: {
      title: "Voice input (speech-to-text)",
      description:
        "Powers the microphone button in the chat composer. Recordings are transcribed by the selected STT provider and dropped into the input box for review before sending.",
      noProviderSelected:
        "No STT provider is selected. The chat microphone button will explain how to set one up when clicked.",
      disableVoiceInput: "Disable voice input",
      sonioxTitle: "Soniox (multilingual · recommended)",
      sonioxDescription:
        "Uses Soniox real-time streaming transcription — words appear in the input box as you speak. Language hints come from your native and target languages, while mixed-language input can still be detected automatically.",
      sonioxApiKeyLabel: "Soniox API key {state}",
      sonioxModel: "Soniox model",
      sonioxModelHint:
        "Use stt-rt-v3 by default; change this only when Soniox publishes a newer real-time model or alias.",
      openaiTitle: "OpenAI-compatible",
      openaiDescription:
        "Use OpenAI Whisper, Groq Whisper, or a local server that implements /audio/transcriptions.",
      openaiApiKeyLabel: "OpenAI-compatible STT key {state}",
      baseUrl: "Base URL (OpenAI-compatible)",
      model: "Model",
      parakeetTitle: "NVIDIA Parakeet V3 (on-device · no key)",
      parakeetDescription:
        "Runs fully on this device — no API key, no network once downloaded. Record-then-transcribe (no live streaming). Best for fast, private transcription when learning a European language.",
      parakeetLangNote:
        "Supports 25 European languages only — no Chinese, Japanese, or Korean. For those, use Soniox.",
      parakeetModelLabel: "Model (~640 MB, downloaded once)",
      parakeetModelHint:
        "Downloaded from the official sherpa-onnx release to your app data folder. Kept across restarts; not included in backups.",
      parakeetDownload: "Download model",
      parakeetRedownload: "Re-download",
      parakeetDownloading: "Downloading… ({index}/{count})",
      parakeetDownloaded: "Downloaded",
      parakeetNotDownloaded: "Not downloaded",
      qwen3Title: "Qwen3-ASR (on-device · no key)",
      qwen3Description:
        "Runs fully on this device — no API key, no network once downloaded. Record-then-transcribe (no live streaming). Supports 30+ languages including Chinese, English, and Cantonese — the local pick for CJK.",
      qwen3ModelLabel: "Model (~1 GB, downloaded once)",
      keySaved: "STT API key encrypted and saved locally.",
      keyCleared: "STT API key cleared from local storage.",
    },
    tts: {
      title: "TTS providers",
      description:
        "The little speaker next to AI replies, corrections, and more-natural sentences in chat triggers speech synthesis. Identical sentences cache their audio to avoid repeat requests.",
      cacheCount: " {n} item(s) currently cached.",
      autoSpeak:
        "Auto-read AI replies (you can still tap the speaker to read manually after turning this off)",
      mimoTitle: "MiMo (neural voice · API key required)",
      edgeTitle: "Microsoft Edge (free · no key needed)",
      edgeStatus: "Free to use · no API key needed",
      edgeDescription:
        "Uses Microsoft Edge online neural voices — free, no API key (synthesis goes through the local backend WebSocket).",
      mimoApiKeyLabel: "MiMo API key {state}",
      stylePrompt: "Reading style prompt (user message)",
      stylePromptPlaceholder:
        "Describe the tone, pace, and emotion of the reading…",
      voice: "Voice",
      model: "Model",
      baseUrl: "Base URL",
      rate: "Rate",
      pitch: "Pitch",
      mimoKeyPlaceholder: "MiMo API key…",
      testTts: "Test reading",
      testing: "Testing…",
      saveKey: "Save key",
      clear: "Clear",
      clearCache: "Clear reading cache",
      clearing: "Clearing…",
      mimoKeySaved: "MiMo TTS API key encrypted and saved locally.",
      mimoKeyCleared: "MiMo TTS API key cleared from local storage.",
      ttsOk: "✓ TTS OK — received {bytes} bytes of audio",
      testFailed: "✗ Failed: {error}",
      noMimoKey: "No MiMo TTS API key yet.",
      cacheCleared: "✓ Cleared reading cache ({n} item(s))",
      cacheClearFailed: "✗ Failed to clear cache: {error}",
    },
    commands: {
      title: "Slash commands",
      description:
        "Customize the / prompt commands used in chat. Each command turns into the prompt below before it's sent to the AI; the bubble still shows what you typed.",
      // {input} is the literal placeholder token (commands.ts PROMPT_INPUT_TOKEN); no interpolation param is passed.
      inputTokenHint:
        "Use {input} in a prompt to mark where the text you type after the command goes. A command without {input} (like /surprise) runs on its own.",
      builtinHeading: "Built-in commands",
      customHeading: "Your commands",
      add: "Add command",
      reset: "Reset",
      delete: "Delete",
      customEmpty:
        "No custom commands yet. Add one to create your own / shortcut.",
      nameLabel: "Command (no spaces)",
      descriptionLabel: "Menu description",
      promptLabel: "Prompt sent to the AI",
      argsHintLabel: "Input hint (shown in the menu)",
      promptPlaceholder:
        "Write the prompt. Use {input} where your typed text should go.",
      nameInvalid: "Use letters, digits, - or _; must start with a letter.",
      nameTaken: "This name is already used by another command.",
      previewLabel: "Preview of what the AI receives",
      // Stand-in shown inside the preview where {input} would be replaced.
      previewSample: "what you type",
    },
  },
  chat: {
    defaultModel: "Model",
    send: "Send",
    selectModel: "Select model",
    emptyModelId: "Model ID not set",
    inputPlaceholderLesson:
      "Ask the teacher, answer exercises — native or target language…",
    inputPlaceholderPractice: "Write a natural reply, or type / for commands",
    replySuggestionTruncated:
      "Reply suggestion truncated due to output length limit ({provider}:{raw}). You can retry; include the reason in parentheses when reporting the issue.",
    generateReplySuggestion: "Generate reply suggestion",
    replySuggestion: "Reply suggestion",
    generatingReplySuggestion: "Generating reply suggestion…",
    editFromHereGrading:
      "Grading in progress — you can re-edit after it finishes",
    editFromHere:
      "Re-edit from here: edit this message, discarding what follows",
    masteryWritten: "Wrote {n} mastery evidence item(s).",
    recordMastery: "Record this lesson answer as mastery evidence",
    masteryPreviewTitle: "Mastery evidence preview",
    masteryPreviewApply: "Write evidence",
    regenerateReply: "Regenerate reply",
    jumpToLatest: "Jump to latest",
    stopGenerating: "Stop generating",
    bilingualTitle: "Target / native language sentence by sentence",
    bilingualReading: "Bilingual reading",
    btwLabel: "By the way · not in context",
    derivedContextLabel: "Conversation context derived by Agent",
    context: {
      scenario: "Scenario",
      userRole: "Your role",
      aiRole: "AI role",
      difficulty: "Difficulty",
      continuity: "Continuity",
      opening: "Opening",
      constraints: "Constraints",
    },
    lessonStartFailed: "Failed to start lesson",
    derivationFailed: "Derivation failed",
    sendFailed: "Send failed",
    sendFailedNoGrading: "Send failed, turn not graded",
    editFromHereTitle: "Restart from this message?",
    editFromHereDesc:
      "This message and all following turns will be discarded; the message text will return to the input for editing. Learning memory already recorded is unaffected.",
    editFromHereConfirm: "Discard and edit",
    lessonBadge: "Lesson",
    practiceBadge: "Practice",
    drillStartFailed: "Failed to start the training session",
    quickfireBadge: "Scenario drill",
    quickfireStartFailed: "Failed to start the scenario drill",
    dictationBadge: "Dictation",
    dictationStartFailed: "Failed to start dictation",
    shadowingBadge: "Read aloud",
    shadowingStartFailed: "Failed to start the read-aloud drill",
    reviewDrillBadge: "Weak-spot drill",
    reviewDrillStartFailed: "Failed to start the weak-spot drill",
    redo: "Say it again: re-produce the corrected version from memory",
    redoPrompt:
      "Say it again — express the same idea once more, using what the correction showed you. No peeking!",
    redoPlaceholder: "Say it again, the corrected way…",
    topicStartFailed: "Failed to start the conversation",
    derivedBadge: "Derived",
    difficultyBadge: "Difficulty·{diff}",
    contextUsage: "~{used} / {limit} tokens · Context {pct}%",
    preparingLesson: "Preparing lesson…",
    lessonStartButton: "Start lesson",
    lessonStartHint: "Press “Start lesson” above to begin",
    startConversation: "Say something in your target language to start.",
    preparingContext: "Generating new conversation context…",
  },
  scopeLabel: {
    profile: {
      name: "Learner profile",
      desc: "interests, preferences, recent practice",
    },
    comfortable: {
      name: "Mastered scaffold",
      desc: "expressions, grammar, collocations safe to reuse",
    },
    weak_all: {
      name: "Weak items",
      desc: "vocab, grammar, collocations, error patterns still unmastered",
    },
    weak_grammar: {
      name: "Grammar / error patterns",
      desc: "recently missed or still-weak grammar points",
    },
    expression_gaps: {
      name: "Expression gaps",
      desc: '"want to say but can\'t" exposed by native/mixed input',
    },
    today_turns: {
      name: "Today's conversation",
      desc: "practice content and corrections from today or last 24h",
    },
    due_review: {
      name: "Due for review",
      desc: "items not revisited for a long time",
    },
    proficiency: {
      name: "Proficiency reading",
      desc: "difficulty calibration inferred from recent performance",
    },
  },
  mastery: {
    deleteTitle: 'Delete "{label}"?',
    deleteDesc: "The event log will be preserved.",
    errorRatio: "Errors/outputs {ratio}",
    lastSeen: "Last seen {date}",
    examplePlaceholder: "Example / original expression",
    notesPlaceholder: "Notes / target expression",
    markKnown: "Mark as mastered",
    history: {
      toggle: "Evidence timeline",
      empty: "No recorded observations for this item yet.",
      source: {
        review: "lesson write-back",
        manual: "added manually",
      },
    },
    searchPlaceholder: "Search key, label, example",
    allStatuses: "All statuses",
    allTypes: "All types",
    status: {
      struggling: "Struggling",
      learning: "Learning",
      known: "Mastered",
    },
    empty: "No matching items",
    naturalEditTitle: "Edit data with natural language",
    naturalEditPlaceholder:
      'e.g. Mark grammar:article_usage as mastered; delete the duplicate make/do collocation; add an expression gap "politely decline a request".',
    naturalEditNote:
      "The system converts the request to a limited set of data operations before code executes it; it does not directly modify counts.",
    processing: "Processing…",
    apply: "Apply",
    preview: "Preview",
    previewTitle: "Preview changes",
    applyPreview: "Apply preview",
    applied: "{summary} Applied {n} item(s).{skipped}",
    skippedSuffix: " Skipped: {items}",
  },
  profile: {
    description:
      "The conversation AI reads this profile for personalized replies. You can write custom preferences here; AI-maintained learning status sections are read-only.",
    loading: "Loading profile…",
    sections: "Profile sections",
    modulesCount: "{n} section(s)",
    aiCustomTitle: "AI preferences",
    aiCustomDesc:
      "Describe your preferences in natural language; the system will write them to your profile and distribute to the corresponding modules.",
    aiPreferenceBadge: "Your settings · preserved when AI maintains profile",
    aiCustomAriaLabel: "Describe AI preferences in one sentence",
    smartDraftPlaceholder:
      "e.g. Use Australian English in conversation; I often dictate, don't fuss over capitalization and punctuation when grading; use Chinese analogies in explanations.",
    aiClassifying: "Classifying…",
    aiClassifySave: "Let AI classify and save",
    finetuneByModule: "Fine-tune by module",
    section: {
      aboutMe: "About me",
      aiPreferences: "AI preferences",
      workingOn: "Working on",
      comfortableWith: "Comfortable with",
      avoids: "Avoids / rarely attempts",
      interests: "Interests",
      recentlyIntroduced: "Recently introduced",
      expressionGaps: "Expression gaps",
      myNotes: "My notes",
    },
    badgeUser: "Your notes · AI never edits",
    badgeShared: "You and AI co-maintain",
    badgeAi: "AI auto-maintains",
    prefGlobalPlaceholder:
      "Applies to all modules, e.g. use Australian English; keep it concise by default",
    prefConversationPlaceholder:
      "Affects regular chat only, e.g. ask more open-ended questions; keep replies concise",
    prefTutorPlaceholder:
      "Affects grading only, e.g. I often dictate, ignore pure capitalization and punctuation issues",
    prefLearningPlaceholder:
      "Affects lessons only, e.g. diagnose before practicing; practice one point at a time",
    prefReadingPlaceholder:
      "Affects reading assistance only, e.g. make translations more colloquial; give more context when explaining idioms",
    maintenanceTitle: "Maintenance",
    maintenanceDesc: "Manual refresh, undo, and raw Markdown editing.",
    saveMarkdown: "Save Markdown",
    alreadySaved: "Saved",
    refreshingBtn: "Refreshing…",
    aiRefresh: "Refresh profile with AI",
    undoRefresh: "Undo AI refresh",
    backToStructured: "Back to structured editing",
    editRawMarkdown: "Edit raw Markdown",
    editSectionLabel: "Edit {name}",
    userSectionPlaceholder:
      "Write something you want AI to remember: reminders, long-term preferences, facts about you… (AI will never edit this)",
    aboutMePlaceholder:
      "Tell the AI who you are so conversations feel personal — e.g. your job and field, what you're studying, where you live, hobbies, and why you're learning this language. One fact per line.",
    aboutMeCalloutTitle: "Introduce yourself",
    aboutMeCalloutDesc:
      "Your conversation partner replies more personally when it knows a bit about you — your work, studies, interests, and why you're learning. Takes a minute and you only do it once.",
    aboutMeCalloutCta: "Fill in About me",
    perLineHint: "One item per line",
    clickToAdd: "Click to add…",
    emptySection: "Empty",
    rawAriaLabel: "Raw Markdown",
    savedStatus: "✓ Saved.",
    aiClassifyingStatus:
      "AI is determining which module this preference belongs to…",
    classifiedStatus: "✓ Classified and saved to profile.",
    classifyFailed: "Classification failed: {error}",
    refreshingStatus:
      "AI is refreshing profile based on mastery data + recent conversations…",
    refreshedStatus: "✓ Profile updated (passed sanity check).",
    refreshNotUpdated: "Not updated: {reason}",
    refreshFailed: "Refresh failed: {error}",
    refreshDiffTitle: "AI refresh changes",
    refreshDiffBefore: "Before",
    refreshDiffAfter: "After",
    refreshDiffDismiss: "Looks good",
    noUndoVersion: "No version to restore.",
    undoneStatus: "✓ Restored to the version before AI refresh.",
  },
  agentLibrary: {
    title: "Capabilities",
    description:
      "All capabilities organized by entry point — each group shows where it triggers and when it appears. You can fine-tune (append supplemental instructions), enable/disable, or delete unused capabilities. Deleting built-in capabilities permanently hides them; deleting custom agents truly removes them; neither affects your learning data.",
    createCustom: "Create custom agent",
    editCustom: "Edit custom agent",
    newAgent: "New agent",
    basicInfo: "Basic info",
    namePlaceholder: "Name, e.g. Interview expression observer",
    descPlaceholder: "One-sentence description of what it does",
    type: "Type",
    observerTitle: "Observer Agent",
    observerDesc:
      "Observes your input in the background each turn, leaving a note in the coach panel.",
    actionTitle: "Conversation Derive Agent",
    actionDesc: "Generates a new conversation after you tap the button.",
    readableData: "Readable data",
    howToChooseScopes: "How to choose data scopes?",
    writebackPolicy: "Write-back policy",
    writebackNone: "Show only, no write suggestions",
    writebackPropose:
      "May propose learning data changes (requires confirmation)",
    observerPromptPlaceholder:
      "Describe what to observe each turn, how to give feedback, and when to propose memory_proposals.",
    actionPromptPlaceholder:
      "Describe how to generate a new conversation context based on the current conversation.",
    replyTransformerTitle: "Transformer Agent",
    replyTransformerDesc:
      "Adds a button to each AI reply or to your own message; runs on that turn when clicked (or automatically).",
    replyTransformerPromptPlaceholder:
      "Describe how to transform the turn — e.g. simplify the reply, point out more natural phrasings in your message, or extract key vocabulary.",
    stageLabel: "When it runs (stage)",
    stageAiReply: "On each AI reply",
    stageUserMessage: "On each message you send",
    stageAiReplyHint:
      "The button appears under the AI's reply and runs on that reply.",
    stageUserMessageHint:
      "The button appears under your own message and runs on what you wrote.",
    iconLabel: "Button icon",
    autoRunLabel: "Run automatically on each new turn",
    autoRunHint: "Otherwise it runs only when you click the button.",
    outputModeLabel: "Output",
    outputModePanel: "Panel below",
    outputModeReplace: "Replace the reply in place",
    outputModeCoach: "Note in the Coach panel",
    outputModeMemory: "Propose a learning-memory update",
    outputPreviewReplyTransformer:
      "Output → depends on the mode you pick above (panel / replace / Coach note / memory proposal).",
    createAndEnable: "Create and enable",
    saveChanges: "Save changes",
    custom: "Custom",
    disabled: "Disabled",
    alwaysOn: "Always on",
    inputOutput: "Input → output",
    timing: "Timing",
    reads: "Reads",
    writes: "Writes",
    tuneTitle: "Fine-tune",
    exportTitle: "Export package",
    deleteTitle: "Delete",
    officialBase: "Official base settings (read-only)",
    supplemental:
      "Supplemental instructions (appended after official settings, does not replace base prompt)",
    supplementalPlaceholder:
      "e.g. Keep explanations shorter; use examples from my industry.",
    tutorWarning:
      'Note: instructions that conflict with the grading system may reduce grading quality. You can "Restore defaults" at any time.',
    restoreDefaults: "Restore defaults",
    supplementalSaved: "Supplemental instructions saved.",
    supplementalCleared:
      "Supplemental instructions cleared, restored to official defaults.",
    restoredDefaults: "Restored to official defaults.",
    customUpdated: "Custom agent updated.",
    customCreated: "Custom agent created and enabled.",
    exportedTo: 'Exported to the package text box under "Advanced" below.',
    deleteCustomTitle: 'Delete custom agent "{name}"?',
    deleteCustomDesc:
      "Permanently deleted from the database, cannot be recovered. Existing conversations are unaffected.",
    deleteBuiltinTitle: 'Delete capability "{name}"?',
    deleteBuiltinDesc:
      "Permanently hides this built-in capability, cannot be recovered — clear app data to restore it.",
    deleted: 'Deleted "{name}".',
    agentNotFound: "This custom agent was not found.",
    advanced: "Advanced · Share package import/export",
    packagePlaceholder:
      "Paste lang-agent.package JSON; old lang-agent.agent-package is also compatible. Exported packages appear here.",
    importPackage: "Import package",
    importConfirmTitle: 'Import "{name}"?',
    importConfirmDesc:
      "{summary}. Runtime skills are imported disabled by default; lessons are available after import.",
    importEnabled: "Enabled after import",
    importDisabled: "Imported disabled by default",
    importedPackage:
      "Package imported: {skills} skill(s), {lessons} lesson(s).",
    logsLink: 'Run logs have moved to "Settings → Logs"',
    outputPreviewObserver:
      "Output → a note in the coach panel (memory_proposals require your confirmation before writing)",
    outputPreviewAction:
      "Output → a new conversation context, automatically starts a new conversation",
    entryMeta: {
      auto_turn: {
        label: "Every turn (auto)",
        intro:
          "These capabilities run automatically in the background every time you speak; results appear in the coach panel.",
      },
      selection: {
        label: "On text selection",
        intro:
          "Learning actions that float up when you select a word or sentence in a message.",
      },
      reply_action: {
        label: "Reply action buttons",
        intro: "Buttons below each AI reply — one tap to use.",
      },
      message_action: {
        label: "On your message",
        intro:
          "Buttons below each message you send — they run on what you just wrote.",
      },
      derive: {
        label: "Derive new conversation",
        intro:
          "After clicking, generates a brand-new conversation based on the current session, without affecting the original.",
      },
      lesson: {
        label: "Lessons",
        intro: "The teacher that runs your lesson-style sessions.",
      },
    },
    entryIo: {
      auto_turn: "Your sentence → corrections / notes in the coach panel",
      selection: "Selected text + context → native-language analysis",
      reply_action:
        "Current reply → explanation / bilingual / suggested reply text",
      message_action: "Your message → a transformed view / note / proposal",
      derive: "Current session → a brand-new conversation",
      lesson: "Your message → teacher-style lesson reply",
    },
  },
  design: {
    title: "Design notes",
    description:
      "This page explains agent responsibilities, storage boundaries, and customization principles. It helps you decide whether to edit a prompt, create a lesson, add an Observer, or directly edit learning data.",
    hotPathTitle: "Core mental model",
    hotPathIntro:
      "Each conversation turn is split into three jobs: natural reply, structured observation, and deterministic accounting. Fast parts stay on the hot path; heavy parts go to the background or are triggered on demand.",
    hotPath: {
      conversation: {
        title: "Conversation Agent",
        body: "Streams a reply immediately every turn. Reads the learner's MD profile and context; handles natural conversation without doing correction accounting.",
      },
      tutor: {
        title: "Tutor Agent",
        body: "Runs in parallel with conversation. Reads SQLite weak items; outputs structured corrections, mastery signals, and expression gaps.",
      },
      accounting: {
        title: "Code accounting",
        body: "The LLM only gives discrete observations; counts, confidence, and state changes are deterministically derived from signals by code and written to the database.",
      },
    },
    agentMatrixTitle: "Agent responsibilities",
    agentMatrixIntro:
      "When designing your own capabilities, first identify which entry point and timing it belongs to. Don't cram grading, conversation, accounting, and lesson planning into one prompt.",
    colAgent: "Agent",
    colTiming: "Timing",
    colReads: "Reads",
    colOutput: "Output",
    colWrites: "Writes",
    agentRow: {
      conversation: {
        timing: "Hot path every turn",
        reads: "MD profile + conversation history + review candidates",
        output: "Natural reply in target language",
      },
      tutor: {
        timing: "Hot path every turn",
        reads: "SQLite weak table + user input",
        output: "TutorAnalysis JSON",
      },
      maintainer: {
        timing: "Background, occasionally",
        reads: "Existing MD + SQLite aggregates + recent conversations",
        output: "Updated learner-profile.md",
        writes: "MD profile",
      },
      task: {
        timing: "When user creates a learning project or lesson",
        reads: "User goal + selected learning data scope",
        output: "Project plan / lesson reply",
      },
      explain: {
        timing: "When user taps the button",
        reads: "Clicked message + context + MD profile slice",
        output: "Explanation / bilingual / suggested reply",
        writes: "Turn on-demand results",
      },
    },
    storageTitle: "Storage design",
    storageIntro:
      "Intentionally split into structured facts and readable narrative. Users can understand and edit the data, but counts and state are kept consistent by code.",
    storage: {
      sqlite: {
        title: "SQLite is ground truth",
        body: "Stores mastery_item, mastery_event, conversation, turn, learning_agent, agent_job, and other structured records — queryable, sortable, recomputable.",
      },
      md: {
        title: "MD profile is the narrative layer",
        body: "Stores user persona, interests, what's being practiced, what's mastered, what's avoided, and personal notes. It lets the conversation agent know who this person is.",
      },
      layers: {
        title: "Neither layer replaces the other",
        body: "Using only MD loses reliable counts; using only SQLite loses qualitative context. So conversation reads MD, tutor reads SQLite, and the maintainer agent writes aggregates back to MD.",
      },
    },
    dataScopesTitle: "Readable data scopes",
    dataScopesIntro:
      'The "readable data" selected when creating a custom agent determines which learning context it can see. Narrower scopes are more stable; broader scopes suit comprehensive summaries.',
    dataScopesNote:
      "In addition, custom agents always see the current input and necessary recent context; these scopes are additional learning data injected.",
    scopeSource: "Source",
    scopeUse: "Use for",
    scopeCaution: "Note",
    scopeDetail: {
      profile: {
        source: "The learner's MD profile written by the maintainer agent.",
        use: "Best for letting capabilities know your interests, preferences, long-term goals, and recent practice direction.",
        caution:
          "It's the narrative layer — not suitable for accurate counts or sorting.",
      },
      comfortable: {
        source: "Stable scaffold selected by code from SQLite mastered items.",
        use: "Best for letting a teacher reuse expressions you already know, connecting new content to existing capability.",
        caution:
          "Don't treat this as all learned content — only a small number of high-value candidates are included.",
      },
      weak_all: {
        source:
          "Vocab, grammar, collocations, error patterns, and expression gaps still unmastered in SQLite.",
        use: "Best for general observer agents, comprehensive review lessons, and capabilities that need targeted remediation.",
        caution:
          "The broadest scope — if a task only cares about grammar or expression gaps, prefer a narrower scope.",
      },
      weak_grammar: {
        source:
          "Recently missed or still-weak grammar and error patterns in SQLite.",
        use: "Best for grammar-focused lessons, error pattern summaries, and pre-interview language check-ups.",
        caution:
          "Does not include regular vocab or expression gaps — don't use it for full learning reports.",
      },
      expression_gaps: {
        source:
          '"Want to say but can\'t" identified by the Tutor from native/mixed input.',
        use: "Best for scenario expression training, reusable sentence pattern lessons, and real-intent rewriting.",
        caution:
          "This is intent-layer data — don't treat every gap as an expression the user has already learned.",
      },
      today_turns: {
        source:
          "Conversation, replies, and correction summaries from the last 24 hours or today.",
        use: "Best for end-of-day review, post-lesson summaries, and generating questions from just-practiced content.",
        caution: "Skews recent — doesn't represent long-term weak rankings.",
      },
      due_review: {
        source:
          "Review candidates selected by code based on weakness and time since last seen.",
        use: "Best for review lessons, warm-up exercises, and naturally inserting old knowledge into conversations.",
        caution:
          "This is a candidate list — agents should use it naturally, not recite it mechanically.",
      },
      proficiency: {
        source:
          "Difficulty calibration inferred by code from recent performance.",
        use: "Best for controlling question difficulty, speaking pace, explanation depth, and target-language ratio.",
        caution:
          "This is a coarse-grained reading — cannot substitute for specific mastery items.",
      },
    },
    customizationTitle: "What you can customize",
    customizationIntro:
      "When customizing capabilities, prefer the smallest entry point: append supplemental instructions before creating a new agent; create a lesson before editing the hot-path Tutor.",
    customization: {
      tune: {
        title: "Fine-tune built-in capabilities",
        body: "In the capabilities library, append supplemental instructions to built-in capabilities — e.g. make explanations shorter, or examples closer to your industry. Supplements don't replace the official base prompt.",
      },
      observer: {
        title: "Create a custom Observer",
        body: "Let it observe each turn from the sidelines and put results in the coach panel. When writing to learning data, it can only propose memory proposals — you confirm, code executes.",
      },
      lesson: {
        title: "Design a lesson",
        body: "A lesson is a teacher-style session, suitable for goals like interviews, business emails, or travel scenarios. It can read a specified learning data scope, but native-language questions in lessons won't be mistakenly counted by the regular Tutor.",
      },
    },
    checklistTitle: "Design checklist",
    checklistRules: {
      r0: "First clarify the entry point: every turn automatically, text selection, reply button, derive new conversation, or lesson.",
      r1: "Then define the read scope: profile, weak items, expression gaps, today's conversation, review candidates, or mastered items.",
      r2: "Output must be verifiable: coach panel annotation, structured proposal, lesson reply, or new conversation context.",
      r3: "Don't let agents directly change counts, keys, providers, or key settings; those are handled only by code and user-confirmed actions.",
      r4: "Reuse stable mastery_keys for the same class of learning problem, otherwise review and statistics get fragmented.",
    },
  },
};

export type Messages = typeof en;
