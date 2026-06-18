import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { en, type Messages } from "./en";
import { zh } from "./zh";

export const UI_LOCALES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
  { value: "ru", label: "Русский" },
  { value: "fr", label: "Français" },
  { value: "tr", label: "Türkçe" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "ja", label: "日本語" },
  { value: "de", label: "Deutsch" },
  { value: "bn", label: "বাংলা" },
  { value: "pl", label: "Polski" },
  { value: "it", label: "Italiano" },
  { value: "ko", label: "한국어" },
  { value: "th", label: "ไทย" },
  { value: "uk", label: "Українська" },
] as const;

export type Locale = (typeof UI_LOCALES)[number]["value"];
export type { Messages };

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]>;
};

function mergeMessages(
  base: Messages,
  override: DeepPartial<Messages>,
): Messages {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!b || typeof b !== "object") return b ?? a;
    if (!a || typeof a !== "object") return b;
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [key, value] of Object.entries(b)) {
      out[key] = merge(out[key], value);
    }
    return out;
  };
  return merge(base, override) as Messages;
}

const romanceCommon = {
  edit: "Editar",
  delete: "Eliminar",
  rename: "Renombrar",
  cancel: "Cancelar",
  save: "Guardar",
  back: "Atrás",
  close: "Cerrar",
  confirm: "Confirmar",
  retry: "Reintentar",
  loading: "Cargando…",
  loadFailed: "No se pudo cargar",
  copy: "Copiar",
  details: "Detalles",
};

const localeOverrides: Record<
  Exclude<Locale, "en" | "zh-CN">,
  DeepPartial<Messages>
> = {
  es: {
    common: romanceCommon,
    errorBoundary: { title: "Algo salió mal", reload: "Recargar" },
    speak: { play: "Leer en voz alta", stop: "Detener lectura" },
    pronunciation: {
      coachTitle: "Pronunciación",
      coachClean:
        "Suena claro: tu pronunciación coincide bien con el objetivo.",
    },
    stt: {
      startRecording: "Entrada de voz (habla y vuelve a pulsar para terminar)",
      stopRecording: "Terminar entrada de voz (Esc para cancelar)",
      noProvider:
        "La entrada de voz está desactivada hasta que elijas un proveedor STT en Ajustes → Entrada de voz.",
      micDenied:
        "Micrófono no disponible: revisa el permiso del sistema para Converloop.",
    },
    onboarding: {
      title: "Bienvenido a Converloop",
      subtitleLanguages:
        "Dile al tutor quién aprende qué. Puedes cambiarlo luego en Ajustes.",
      subtitleProvider:
        "Conecta un modelo de IA para conversaciones y correcciones. Tu clave se queda en este dispositivo.",
      provider: "Proveedor de modelo",
      keyPlaceholder: "Pega tu clave API de {provider}",
      saveAndTest: "Guardar clave y probar",
      testOk: "Conectado: el modelo respondió “{sample}”.",
      loginOk: "Sesión iniciada. Token guardado.",
      noCredential: "Aún no hay clave ni sesión para este proveedor.",
      next: "Siguiente",
      finish: "Empezar a aprender",
      skip: "Omitir por ahora",
    },
    replyExplanation: {
      explain: "Explicar",
      explainTooltip: "Explica esta respuesta según lo que ya dominas",
    },
    corrections: {
      nativeInputTitle: "Entrada en lengua nativa / mixta",
      nativeFallback: "Nativa",
      analyzing: "Analizando…",
      correct: "Parece correcto",
      noChanges: "No hacen falta correcciones",
      unavailable: "Corrección no disponible",
      explain: "Explicar",
      languageCorrection: "Corrección lingüística",
      correctedSentence: "Frase corregida",
      naturalExpression: "Expresión natural",
      expressionTemplate: "Patrón reutilizable",
      grammarDetails: "Detalles gramaticales",
      explanationHeader: "Explicación",
      keyItems: "Palabras / patrones clave",
    },
    chat: {
      send: "Enviar",
      inputPlaceholderLesson: "Pregunta al profesor o responde ejercicios…",
      inputPlaceholderPractice:
        "Escribe una respuesta natural o usa / para comandos",
      regenerateReply: "Regenerar respuesta",
      jumpToLatest: "Ir a lo más reciente",
      stopGenerating: "Detener generación",
      readingGuideTitle: "Mostrar pinyin / furigana sobre el texto objetivo",
      readingGuide: "Guía de lectura",
      bilingualTitle: "Idioma objetivo / lengua nativa frase por frase",
      bilingualReading: "Lectura bilingüe",
      btwLabel: "Por cierto · fuera de contexto",
    },
    settings: {
      general: {
        title: "Ajustes generales",
        description:
          "Ajusta la apariencia y los idiomas de aprendizaje. Se guarda localmente.",
        theme: "Tema",
        accent: "Color de acento",
        interfaceLanguage: "Idioma de la interfaz",
        nativeLanguage: "Lengua nativa",
        targetLanguage: "Idioma objetivo",
        level: "Nivel",
        dailyGoal: "Objetivo diario",
        autoBilingual: "Abrir automáticamente la lectura bilingüe",
        actionLabels: "Mostrar etiquetas en botones del chat",
        inputHintsAuto: "Sugerencias automáticas cada turno",
        glass: "Activar efecto cristal de macOS",
      },
      languages: { en: "English", zh: "中文" },
      stt: {
        title: "Entrada de voz (STT)",
        onlineGroup: "En línea",
        onlineGroupHint:
          "Requiere clave API y red; la transcripción se hace en la nube.",
        localGroup: "En el dispositivo",
        localGroupHint: "Funciona sin conexión tras descargar el modelo.",
        disableVoiceInput: "Desactivar entrada de voz",
        sonioxTitle: "Soniox (multilingüe · recomendado)",
        openaiTitle: "Compatible con OpenAI",
        parakeetTitle: "NVIDIA Parakeet V3 (local · sin clave)",
        qwen3Title: "Qwen3-ASR (local · sin clave)",
      },
    },
    viewTitles: {
      today: "Chat",
      mastery: "Datos de aprendizaje",
      learning: "Crear clase",
      customLearning: "Centro de entrenamiento",
      listening: "Escucha",
      agents: "Capacidades",
      logs: "Registros",
      general: "Ajustes generales",
      llm: "Modelos",
      stt: "Entrada de voz",
      tts: "Voz",
      commands: "Comandos /",
    },
  },
  pt: {
    common: {
      edit: "Editar",
      delete: "Excluir",
      rename: "Renomear",
      cancel: "Cancelar",
      save: "Salvar",
      back: "Voltar",
      close: "Fechar",
      confirm: "Confirmar",
      retry: "Tentar novamente",
      loading: "Carregando…",
      loadFailed: "Falha ao carregar",
      copy: "Copiar",
      details: "Detalhes",
    },
    errorBoundary: { title: "Algo deu errado", reload: "Recarregar" },
    speak: { play: "Ler em voz alta", stop: "Parar leitura" },
    onboarding: {
      title: "Bem-vindo ao Converloop",
      provider: "Provedor de modelo",
      next: "Próximo",
      finish: "Começar a aprender",
      skip: "Pular por enquanto",
    },
    replyExplanation: {
      explain: "Explicar",
      explainTooltip: "Explicar esta resposta com base no que você já domina",
    },
    chat: {
      send: "Enviar",
      regenerateReply: "Gerar novamente",
      jumpToLatest: "Ir para o mais recente",
      stopGenerating: "Parar geração",
      readingGuideTitle: "Mostrar pinyin / furigana acima do texto alvo",
      readingGuide: "Guia de leitura",
      bilingualTitle: "Idioma alvo / nativo frase por frase",
      bilingualReading: "Leitura bilíngue",
      btwLabel: "A propósito · fora do contexto",
    },
    settings: {
      general: {
        title: "Configurações gerais",
        interfaceLanguage: "Idioma da interface",
        nativeLanguage: "Idioma nativo",
        targetLanguage: "Idioma alvo",
        level: "Nível",
        dailyGoal: "Meta diária",
        theme: "Tema",
        accent: "Cor de destaque",
      },
      stt: {
        title: "Entrada de voz (STT)",
        onlineGroup: "Online",
        localGroup: "No dispositivo",
        disableVoiceInput: "Desativar entrada de voz",
      },
    },
    viewTitles: {
      today: "Chat",
      mastery: "Dados de aprendizagem",
      learning: "Criar aula",
      customLearning: "Centro de treino",
      listening: "Escuta",
      agents: "Capacidades",
      logs: "Registros",
      general: "Configurações",
      llm: "Modelos",
      stt: "Entrada de voz",
      tts: "Voz",
      commands: "Comandos /",
    },
  },
  "zh-TW": {
    common: {
      edit: "編輯",
      delete: "刪除",
      rename: "重新命名",
      cancel: "取消",
      save: "儲存",
      back: "返回",
      close: "關閉",
      confirm: "確認",
      retry: "重試",
      loading: "載入中…",
      loadFailed: "載入失敗",
      copy: "複製",
      details: "詳細資訊",
    },
    errorBoundary: { title: "發生錯誤", reload: "重新載入" },
    speak: { play: "朗讀", stop: "停止朗讀" },
    onboarding: {
      title: "歡迎使用 Converloop",
      subtitleLanguages: "告訴教練誰在學什麼。之後可在設定中修改。",
      subtitleProvider:
        "連接一個 AI 模型來支援對話與批改。金鑰只會保存在本機。",
      provider: "模型供應商",
      keyPlaceholder: "貼上你的 {provider} API key",
      saveAndTest: "儲存金鑰並測試",
      testOk: "已連線，模型回覆「{sample}」。",
      loginOk: "已登入，訂閱 token 已儲存。",
      noCredential: "這個供應商尚未設定金鑰或登入。",
      next: "下一步",
      finish: "開始學習",
      skip: "暫時略過",
    },
    replyExplanation: {
      explain: "講解",
      explainTooltip: "根據你已掌握的內容講解這則回覆",
    },
    chat: {
      send: "送出",
      regenerateReply: "重新生成回覆",
      jumpToLatest: "回到最新",
      stopGenerating: "停止生成",
      readingGuideTitle: "在目標語言文字上方顯示拼音 / 振假名",
      readingGuide: "注音",
      bilingualTitle: "目標語言 / 母語逐句對照",
      bilingualReading: "雙語閱讀",
      btwLabel: "順便一問 · 不計入上下文",
    },
    settings: {
      general: {
        title: "通用設定",
        description: "調整外觀與學習語言。設定會立即儲存在本機。",
        interfaceLanguage: "介面語言",
        nativeLanguage: "母語",
        targetLanguage: "目標語言",
        level: "程度",
        dailyGoal: "每日目標",
        theme: "主題",
        accent: "主題色",
        autoBilingual: "AI 回覆自動開啟雙語閱讀",
        actionLabels: "對話功能按鈕顯示文字",
        inputHintsAuto: "每輪自動提供回覆提示",
        glass: "開啟 macOS 玻璃效果",
      },
      stt: {
        title: "語音輸入 (STT)",
        onlineGroup: "線上",
        onlineGroupHint: "需要 API key 與網路，轉寫在雲端完成。",
        localGroup: "本機",
        localGroupHint: "在本機離線執行，需先下載模型。",
        disableVoiceInput: "關閉語音輸入",
      },
    },
    viewTitles: {
      today: "對話",
      mastery: "學習資料",
      learning: "建立專項課",
      customLearning: "訓練中心",
      listening: "聽力",
      agents: "能力庫",
      logs: "日誌",
      general: "通用設定",
      llm: "模型供應商",
      stt: "語音輸入",
      tts: "語音輸出",
      commands: "斜線命令",
    },
  },
  ar: {
    common: {
      edit: "تعديل",
      delete: "حذف",
      rename: "إعادة تسمية",
      cancel: "إلغاء",
      save: "حفظ",
      back: "رجوع",
      close: "إغلاق",
      confirm: "تأكيد",
      retry: "إعادة المحاولة",
      loading: "جارٍ التحميل…",
      loadFailed: "فشل التحميل",
      copy: "نسخ",
      details: "التفاصيل",
    },
    errorBoundary: { title: "حدث خطأ ما", reload: "إعادة التحميل" },
    speak: { play: "اقرأ بصوت عالٍ", stop: "إيقاف القراءة" },
    onboarding: {
      title: "مرحبًا بك في Converloop",
      provider: "مزود النموذج",
      next: "التالي",
      finish: "ابدأ التعلم",
      skip: "تخطي الآن",
    },
    replyExplanation: {
      explain: "اشرح",
      explainTooltip: "اشرح هذه الإجابة بناءً على ما أتقنته",
    },
    chat: {
      send: "إرسال",
      regenerateReply: "إعادة توليد الرد",
      jumpToLatest: "الانتقال إلى الأحدث",
      stopGenerating: "إيقاف التوليد",
      readingGuideTitle: "إظهار البينيين / الفوريغانا فوق النص الهدف",
      readingGuide: "دليل القراءة",
      bilingualTitle: "اللغة الهدف / اللغة الأم جملة بجملة",
      bilingualReading: "قراءة ثنائية اللغة",
      btwLabel: "بالمناسبة · خارج السياق",
    },
    settings: {
      general: {
        title: "الإعدادات العامة",
        interfaceLanguage: "لغة الواجهة",
        nativeLanguage: "اللغة الأم",
        targetLanguage: "اللغة الهدف",
        level: "المستوى",
        dailyGoal: "الهدف اليومي",
        theme: "السمة",
        accent: "لون التمييز",
      },
      stt: {
        title: "إدخال صوتي (STT)",
        onlineGroup: "عبر الإنترنت",
        localGroup: "على الجهاز",
        disableVoiceInput: "تعطيل الإدخال الصوتي",
      },
    },
    viewTitles: {
      today: "المحادثة",
      mastery: "بيانات التعلم",
      learning: "إنشاء درس",
      customLearning: "مركز التدريب",
      listening: "الاستماع",
      agents: "القدرات",
      logs: "السجلات",
      general: "الإعدادات",
      llm: "النماذج",
      stt: "إدخال صوتي",
      tts: "الصوت",
      commands: "أوامر /",
    },
  },
  hi: {
    common: {
      edit: "संपादित करें",
      delete: "हटाएँ",
      rename: "नाम बदलें",
      cancel: "रद्द करें",
      save: "सहेजें",
      back: "वापस",
      close: "बंद करें",
      confirm: "पुष्टि करें",
      retry: "फिर कोशिश करें",
      loading: "लोड हो रहा है…",
      loadFailed: "लोड नहीं हुआ",
      copy: "कॉपी करें",
      details: "विवरण",
    },
    errorBoundary: { title: "कुछ गलत हो गया", reload: "रीलोड करें" },
    speak: { play: "ज़ोर से पढ़ें", stop: "पढ़ना रोकें" },
    onboarding: {
      title: "Converloop में आपका स्वागत है",
      provider: "मॉडल प्रदाता",
      next: "आगे",
      finish: "सीखना शुरू करें",
      skip: "अभी छोड़ें",
    },
    replyExplanation: {
      explain: "समझाएँ",
      explainTooltip: "आपकी महारत के आधार पर इस उत्तर को समझाएँ",
    },
    chat: {
      send: "भेजें",
      regenerateReply: "उत्तर फिर बनाएँ",
      jumpToLatest: "नवीनतम पर जाएँ",
      stopGenerating: "जनरेशन रोकें",
      readingGuideTitle: "लक्ष्य पाठ के ऊपर पिनयिन / फुरिगाना दिखाएँ",
      readingGuide: "रीडिंग गाइड",
      bilingualTitle: "लक्ष्य / मातृ भाषा वाक्य-दर-वाक्य",
      bilingualReading: "द्विभाषी पढ़ना",
      btwLabel: "वैसे · संदर्भ से बाहर",
    },
    settings: {
      general: {
        title: "सामान्य सेटिंग्स",
        interfaceLanguage: "इंटरफ़ेस भाषा",
        nativeLanguage: "मातृ भाषा",
        targetLanguage: "लक्ष्य भाषा",
        level: "स्तर",
        dailyGoal: "दैनिक लक्ष्य",
        theme: "थीम",
        accent: "एक्सेंट रंग",
      },
      stt: {
        title: "वॉइस इनपुट (STT)",
        onlineGroup: "ऑनलाइन",
        localGroup: "डिवाइस पर",
        disableVoiceInput: "वॉइस इनपुट बंद करें",
      },
    },
    viewTitles: {
      today: "चैट",
      mastery: "सीखने का डेटा",
      learning: "पाठ बनाएँ",
      customLearning: "ट्रेनिंग सेंटर",
      listening: "सुनना",
      agents: "क्षमताएँ",
      logs: "लॉग",
      general: "सेटिंग्स",
      llm: "मॉडल",
      stt: "वॉइस इनपुट",
      tts: "आवाज़",
      commands: "/ कमांड",
    },
  },
  ru: {
    common: {
      edit: "Изменить",
      delete: "Удалить",
      rename: "Переименовать",
      cancel: "Отмена",
      save: "Сохранить",
      back: "Назад",
      close: "Закрыть",
      confirm: "Подтвердить",
      retry: "Повторить",
      loading: "Загрузка…",
      loadFailed: "Не удалось загрузить",
      copy: "Копировать",
      details: "Подробности",
    },
    errorBoundary: { title: "Что-то пошло не так", reload: "Перезагрузить" },
    speak: { play: "Прочитать вслух", stop: "Остановить чтение" },
    onboarding: {
      title: "Добро пожаловать в Converloop",
      provider: "Поставщик модели",
      next: "Далее",
      finish: "Начать обучение",
      skip: "Пропустить пока",
    },
    replyExplanation: {
      explain: "Объяснить",
      explainTooltip: "Объяснить этот ответ с учётом того, что вы уже освоили",
    },
    chat: {
      send: "Отправить",
      regenerateReply: "Сгенерировать заново",
      jumpToLatest: "К последнему",
      stopGenerating: "Остановить генерацию",
      readingGuideTitle: "Показать пиньинь / фуригану над целевым текстом",
      readingGuide: "Подсказка чтения",
      bilingualTitle: "Целевой / родной язык по предложениям",
      bilingualReading: "Двуязычное чтение",
      btwLabel: "Кстати · вне контекста",
    },
    settings: {
      general: {
        title: "Общие настройки",
        interfaceLanguage: "Язык интерфейса",
        nativeLanguage: "Родной язык",
        targetLanguage: "Целевой язык",
        level: "Уровень",
        dailyGoal: "Цель на день",
        theme: "Тема",
        accent: "Акцентный цвет",
      },
      stt: {
        title: "Голосовой ввод (STT)",
        onlineGroup: "Онлайн",
        localGroup: "На устройстве",
        disableVoiceInput: "Отключить голосовой ввод",
      },
    },
    viewTitles: {
      today: "Чат",
      mastery: "Данные обучения",
      learning: "Создать урок",
      customLearning: "Тренировки",
      listening: "Аудирование",
      agents: "Возможности",
      logs: "Журналы",
      general: "Настройки",
      llm: "Модели",
      stt: "Голосовой ввод",
      tts: "Озвучка",
      commands: "/ команды",
    },
  },
  fr: {
    common: {
      edit: "Modifier",
      delete: "Supprimer",
      rename: "Renommer",
      cancel: "Annuler",
      save: "Enregistrer",
      back: "Retour",
      close: "Fermer",
      confirm: "Confirmer",
      retry: "Réessayer",
      loading: "Chargement…",
      loadFailed: "Échec du chargement",
      copy: "Copier",
      details: "Détails",
    },
    errorBoundary: { title: "Une erreur est survenue", reload: "Recharger" },
    speak: { play: "Lire à voix haute", stop: "Arrêter la lecture" },
    onboarding: {
      title: "Bienvenue dans Converloop",
      provider: "Fournisseur de modèle",
      next: "Suivant",
      finish: "Commencer à apprendre",
      skip: "Ignorer pour l’instant",
    },
    replyExplanation: {
      explain: "Expliquer",
      explainTooltip: "Expliquer cette réponse selon ce que vous maîtrisez",
    },
    chat: {
      send: "Envoyer",
      regenerateReply: "Regénérer la réponse",
      jumpToLatest: "Aller au plus récent",
      stopGenerating: "Arrêter la génération",
      readingGuideTitle:
        "Afficher le pinyin / furigana au-dessus du texte cible",
      readingGuide: "Guide de lecture",
      bilingualTitle: "Langue cible / langue maternelle phrase par phrase",
      bilingualReading: "Lecture bilingue",
      btwLabel: "Au fait · hors contexte",
    },
    settings: {
      general: {
        title: "Paramètres généraux",
        interfaceLanguage: "Langue de l’interface",
        nativeLanguage: "Langue maternelle",
        targetLanguage: "Langue cible",
        level: "Niveau",
        dailyGoal: "Objectif quotidien",
        theme: "Thème",
        accent: "Couleur d’accent",
      },
      stt: {
        title: "Entrée vocale (STT)",
        onlineGroup: "En ligne",
        localGroup: "Sur l’appareil",
        disableVoiceInput: "Désactiver l’entrée vocale",
      },
    },
    viewTitles: {
      today: "Chat",
      mastery: "Données d’apprentissage",
      learning: "Créer un cours",
      customLearning: "Centre d’entraînement",
      listening: "Écoute",
      agents: "Capacités",
      logs: "Journaux",
      general: "Paramètres",
      llm: "Modèles",
      stt: "Entrée vocale",
      tts: "Voix",
      commands: "Commandes /",
    },
  },
  tr: {
    common: {
      edit: "Düzenle",
      delete: "Sil",
      rename: "Yeniden adlandır",
      cancel: "İptal",
      save: "Kaydet",
      back: "Geri",
      close: "Kapat",
      confirm: "Onayla",
      retry: "Tekrar dene",
      loading: "Yükleniyor…",
      loadFailed: "Yüklenemedi",
      copy: "Kopyala",
      details: "Ayrıntılar",
    },
    errorBoundary: { title: "Bir şeyler ters gitti", reload: "Yenile" },
    speak: { play: "Sesli oku", stop: "Okumayı durdur" },
    onboarding: {
      title: "Converloop’a hoş geldiniz",
      provider: "Model sağlayıcı",
      next: "İleri",
      finish: "Öğrenmeye başla",
      skip: "Şimdilik geç",
    },
    replyExplanation: {
      explain: "Açıkla",
      explainTooltip: "Bu yanıtı bildiklerine göre açıkla",
    },
    chat: {
      send: "Gönder",
      regenerateReply: "Yanıtı yeniden oluştur",
      jumpToLatest: "En son mesaja git",
      stopGenerating: "Üretimi durdur",
      readingGuideTitle: "Hedef metnin üzerinde pinyin / furigana göster",
      readingGuide: "Okuma kılavuzu",
      bilingualTitle: "Hedef / ana dil cümle cümle",
      bilingualReading: "İki dilli okuma",
      btwLabel: "Bu arada · bağlam dışında",
    },
    settings: {
      general: {
        title: "Genel ayarlar",
        interfaceLanguage: "Arayüz dili",
        nativeLanguage: "Ana dil",
        targetLanguage: "Hedef dil",
        level: "Seviye",
        dailyGoal: "Günlük hedef",
        theme: "Tema",
        accent: "Vurgu rengi",
      },
      stt: {
        title: "Ses girişi (STT)",
        onlineGroup: "Çevrimiçi",
        localGroup: "Cihazda",
        disableVoiceInput: "Ses girişini kapat",
      },
    },
    viewTitles: {
      today: "Sohbet",
      mastery: "Öğrenme verileri",
      learning: "Ders oluştur",
      customLearning: "Antrenman merkezi",
      listening: "Dinleme",
      agents: "Yetenekler",
      logs: "Kayıtlar",
      general: "Ayarlar",
      llm: "Modeller",
      stt: "Ses girişi",
      tts: "Ses",
      commands: "/ komutları",
    },
  },
  vi: {
    common: {
      edit: "Sửa",
      delete: "Xóa",
      rename: "Đổi tên",
      cancel: "Hủy",
      save: "Lưu",
      back: "Quay lại",
      close: "Đóng",
      confirm: "Xác nhận",
      retry: "Thử lại",
      loading: "Đang tải…",
      loadFailed: "Tải thất bại",
      copy: "Sao chép",
      details: "Chi tiết",
    },
    errorBoundary: { title: "Đã xảy ra lỗi", reload: "Tải lại" },
    speak: { play: "Đọc to", stop: "Dừng đọc" },
    onboarding: {
      title: "Chào mừng đến với Converloop",
      provider: "Nhà cung cấp mô hình",
      next: "Tiếp",
      finish: "Bắt đầu học",
      skip: "Bỏ qua lúc này",
    },
    replyExplanation: {
      explain: "Giải thích",
      explainTooltip: "Giải thích câu trả lời này dựa trên những gì bạn đã nắm",
    },
    chat: {
      send: "Gửi",
      regenerateReply: "Tạo lại câu trả lời",
      jumpToLatest: "Đến mới nhất",
      stopGenerating: "Dừng tạo",
      readingGuideTitle: "Hiển thị pinyin / furigana trên văn bản mục tiêu",
      readingGuide: "Hướng dẫn đọc",
      bilingualTitle: "Ngôn ngữ mục tiêu / tiếng mẹ đẻ theo từng câu",
      bilingualReading: "Đọc song ngữ",
      btwLabel: "Nhân tiện · ngoài ngữ cảnh",
    },
    settings: {
      general: {
        title: "Cài đặt chung",
        interfaceLanguage: "Ngôn ngữ giao diện",
        nativeLanguage: "Tiếng mẹ đẻ",
        targetLanguage: "Ngôn ngữ mục tiêu",
        level: "Trình độ",
        dailyGoal: "Mục tiêu hằng ngày",
        theme: "Giao diện",
        accent: "Màu nhấn",
      },
      stt: {
        title: "Nhập giọng nói (STT)",
        onlineGroup: "Trực tuyến",
        localGroup: "Trên thiết bị",
        disableVoiceInput: "Tắt nhập giọng nói",
      },
    },
    viewTitles: {
      today: "Trò chuyện",
      mastery: "Dữ liệu học",
      learning: "Tạo bài học",
      customLearning: "Trung tâm luyện tập",
      listening: "Nghe",
      agents: "Khả năng",
      logs: "Nhật ký",
      general: "Cài đặt",
      llm: "Mô hình",
      stt: "Nhập giọng nói",
      tts: "Giọng đọc",
      commands: "Lệnh /",
    },
  },
  id: {
    common: {
      edit: "Edit",
      delete: "Hapus",
      rename: "Ganti nama",
      cancel: "Batal",
      save: "Simpan",
      back: "Kembali",
      close: "Tutup",
      confirm: "Konfirmasi",
      retry: "Coba lagi",
      loading: "Memuat…",
      loadFailed: "Gagal memuat",
      copy: "Salin",
      details: "Detail",
    },
    errorBoundary: { title: "Terjadi kesalahan", reload: "Muat ulang" },
    speak: { play: "Baca keras", stop: "Berhenti membaca" },
    onboarding: {
      title: "Selamat datang di Converloop",
      provider: "Penyedia model",
      next: "Lanjut",
      finish: "Mulai belajar",
      skip: "Lewati dulu",
    },
    replyExplanation: {
      explain: "Jelaskan",
      explainTooltip: "Jelaskan balasan ini berdasarkan yang sudah kamu kuasai",
    },
    chat: {
      send: "Kirim",
      regenerateReply: "Buat ulang balasan",
      jumpToLatest: "Ke terbaru",
      stopGenerating: "Hentikan pembuatan",
      readingGuideTitle: "Tampilkan pinyin / furigana di atas teks target",
      readingGuide: "Panduan baca",
      bilingualTitle: "Bahasa target / bahasa ibu per kalimat",
      bilingualReading: "Bacaan dwibahasa",
      btwLabel: "Ngomong-ngomong · di luar konteks",
    },
    settings: {
      general: {
        title: "Pengaturan umum",
        interfaceLanguage: "Bahasa antarmuka",
        nativeLanguage: "Bahasa ibu",
        targetLanguage: "Bahasa target",
        level: "Level",
        dailyGoal: "Target harian",
        theme: "Tema",
        accent: "Warna aksen",
      },
      stt: {
        title: "Input suara (STT)",
        onlineGroup: "Online",
        localGroup: "Di perangkat",
        disableVoiceInput: "Nonaktifkan input suara",
      },
    },
    viewTitles: {
      today: "Chat",
      mastery: "Data belajar",
      learning: "Buat pelajaran",
      customLearning: "Pusat latihan",
      listening: "Mendengarkan",
      agents: "Kemampuan",
      logs: "Log",
      general: "Pengaturan",
      llm: "Model",
      stt: "Input suara",
      tts: "Suara",
      commands: "Perintah /",
    },
  },
  ja: {
    common: {
      edit: "編集",
      delete: "削除",
      rename: "名前を変更",
      cancel: "キャンセル",
      save: "保存",
      back: "戻る",
      close: "閉じる",
      confirm: "確認",
      retry: "再試行",
      loading: "読み込み中…",
      loadFailed: "読み込みに失敗しました",
      copy: "コピー",
      details: "詳細",
    },
    errorBoundary: { title: "問題が発生しました", reload: "再読み込み" },
    speak: { play: "読み上げ", stop: "読み上げ停止" },
    onboarding: {
      title: "Converloop へようこそ",
      provider: "モデルプロバイダー",
      next: "次へ",
      finish: "学習を始める",
      skip: "今はスキップ",
    },
    replyExplanation: {
      explain: "解説",
      explainTooltip: "習得状況に合わせてこの返信を解説",
    },
    chat: {
      send: "送信",
      regenerateReply: "返信を再生成",
      jumpToLatest: "最新へ移動",
      stopGenerating: "生成を停止",
      readingGuideTitle: "目標テキストの上にピンイン / ふりがなを表示",
      readingGuide: "読み方",
      bilingualTitle: "目標言語 / 母語を文ごとに表示",
      bilingualReading: "バイリンガル表示",
      btwLabel: "ちなみに · 文脈外",
    },
    settings: {
      general: {
        title: "一般設定",
        interfaceLanguage: "表示言語",
        nativeLanguage: "母語",
        targetLanguage: "学習言語",
        level: "レベル",
        dailyGoal: "毎日の目標",
        theme: "テーマ",
        accent: "アクセントカラー",
      },
      stt: {
        title: "音声入力 (STT)",
        onlineGroup: "オンライン",
        localGroup: "端末上",
        disableVoiceInput: "音声入力を無効にする",
      },
    },
    viewTitles: {
      today: "チャット",
      mastery: "学習データ",
      learning: "レッスン作成",
      customLearning: "トレーニング",
      listening: "リスニング",
      agents: "機能",
      logs: "ログ",
      general: "設定",
      llm: "モデル",
      stt: "音声入力",
      tts: "音声",
      commands: "/ コマンド",
    },
  },
  de: {
    common: {
      edit: "Bearbeiten",
      delete: "Löschen",
      rename: "Umbenennen",
      cancel: "Abbrechen",
      save: "Speichern",
      back: "Zurück",
      close: "Schließen",
      confirm: "Bestätigen",
      retry: "Erneut versuchen",
      loading: "Lädt…",
      loadFailed: "Laden fehlgeschlagen",
      copy: "Kopieren",
      details: "Details",
    },
    errorBoundary: { title: "Etwas ist schiefgelaufen", reload: "Neu laden" },
    speak: { play: "Vorlesen", stop: "Vorlesen stoppen" },
    onboarding: {
      title: "Willkommen bei Converloop",
      provider: "Modellanbieter",
      next: "Weiter",
      finish: "Lernen starten",
      skip: "Vorerst überspringen",
    },
    replyExplanation: {
      explain: "Erklären",
      explainTooltip: "Diese Antwort anhand deiner Kenntnisse erklären",
    },
    chat: {
      send: "Senden",
      regenerateReply: "Antwort neu generieren",
      jumpToLatest: "Zum Neuesten",
      stopGenerating: "Generierung stoppen",
      readingGuideTitle: "Pinyin / Furigana über dem Zieltext anzeigen",
      readingGuide: "Lesehilfe",
      bilingualTitle: "Zielsprache / Muttersprache Satz für Satz",
      bilingualReading: "Zweisprachiges Lesen",
      btwLabel: "Übrigens · nicht im Kontext",
    },
    settings: {
      general: {
        title: "Allgemeine Einstellungen",
        interfaceLanguage: "Oberflächensprache",
        nativeLanguage: "Muttersprache",
        targetLanguage: "Zielsprache",
        level: "Niveau",
        dailyGoal: "Tagesziel",
        theme: "Design",
        accent: "Akzentfarbe",
      },
      stt: {
        title: "Spracheingabe (STT)",
        onlineGroup: "Online",
        localGroup: "Auf dem Gerät",
        disableVoiceInput: "Spracheingabe deaktivieren",
      },
    },
    viewTitles: {
      today: "Chat",
      mastery: "Lerndaten",
      learning: "Lektion erstellen",
      customLearning: "Trainingszentrum",
      listening: "Hören",
      agents: "Funktionen",
      logs: "Protokolle",
      general: "Einstellungen",
      llm: "Modelle",
      stt: "Spracheingabe",
      tts: "Stimme",
      commands: "/ Befehle",
    },
  },
  bn: {
    common: {
      edit: "সম্পাদনা",
      delete: "মুছুন",
      rename: "নাম বদলান",
      cancel: "বাতিল",
      save: "সংরক্ষণ",
      back: "ফিরে যান",
      close: "বন্ধ",
      confirm: "নিশ্চিত করুন",
      retry: "আবার চেষ্টা করুন",
      loading: "লোড হচ্ছে…",
      loadFailed: "লোড ব্যর্থ",
      copy: "কপি",
      details: "বিস্তারিত",
    },
    errorBoundary: { title: "কিছু ভুল হয়েছে", reload: "রিলোড" },
    speak: { play: "জোরে পড়ুন", stop: "পড়া থামান" },
    onboarding: {
      title: "Converloop-এ স্বাগতম",
      provider: "মডেল প্রদানকারী",
      next: "পরবর্তী",
      finish: "শেখা শুরু করুন",
      skip: "এখন এড়িয়ে যান",
    },
    replyExplanation: {
      explain: "ব্যাখ্যা",
      explainTooltip: "আপনার শেখার অবস্থার ভিত্তিতে এই উত্তর ব্যাখ্যা করুন",
    },
    chat: {
      send: "পাঠান",
      regenerateReply: "উত্তর আবার তৈরি করুন",
      jumpToLatest: "সর্বশেষে যান",
      stopGenerating: "তৈরি বন্ধ করুন",
      readingGuideTitle: "লক্ষ্য লেখার ওপর পিনইন / ফুরিগানা দেখান",
      readingGuide: "পড়ার সহায়িকা",
      bilingualTitle: "লক্ষ্য ভাষা / মাতৃভাষা বাক্য ধরে",
      bilingualReading: "দ্বিভাষিক পাঠ",
      btwLabel: "প্রসঙ্গক্রমে · প্রসঙ্গের বাইরে",
    },
    settings: {
      general: {
        title: "সাধারণ সেটিংস",
        interfaceLanguage: "ইন্টারফেস ভাষা",
        nativeLanguage: "মাতৃভাষা",
        targetLanguage: "লক্ষ্য ভাষা",
        level: "স্তর",
        dailyGoal: "দৈনিক লক্ষ্য",
        theme: "থিম",
        accent: "অ্যাকসেন্ট রং",
      },
      stt: {
        title: "ভয়েস ইনপুট (STT)",
        onlineGroup: "অনলাইন",
        localGroup: "ডিভাইসে",
        disableVoiceInput: "ভয়েস ইনপুট বন্ধ করুন",
      },
    },
    viewTitles: {
      today: "চ্যাট",
      mastery: "শেখার ডেটা",
      learning: "পাঠ তৈরি",
      customLearning: "ট্রেনিং সেন্টার",
      listening: "শোনা",
      agents: "ক্ষমতা",
      logs: "লগ",
      general: "সেটিংস",
      llm: "মডেল",
      stt: "ভয়েস ইনপুট",
      tts: "ভয়েস",
      commands: "/ কমান্ড",
    },
  },
  pl: {
    common: {
      edit: "Edytuj",
      delete: "Usuń",
      rename: "Zmień nazwę",
      cancel: "Anuluj",
      save: "Zapisz",
      back: "Wstecz",
      close: "Zamknij",
      confirm: "Potwierdź",
      retry: "Spróbuj ponownie",
      loading: "Ładowanie…",
      loadFailed: "Nie udało się załadować",
      copy: "Kopiuj",
      details: "Szczegóły",
    },
    errorBoundary: { title: "Coś poszło nie tak", reload: "Odśwież" },
    speak: { play: "Czytaj na głos", stop: "Zatrzymaj czytanie" },
    onboarding: {
      title: "Witamy w Converloop",
      provider: "Dostawca modelu",
      next: "Dalej",
      finish: "Zacznij naukę",
      skip: "Pomiń na razie",
    },
    replyExplanation: {
      explain: "Wyjaśnij",
      explainTooltip: "Wyjaśnij tę odpowiedź na podstawie tego, co już umiesz",
    },
    chat: {
      send: "Wyślij",
      regenerateReply: "Wygeneruj ponownie",
      jumpToLatest: "Przejdź do najnowszego",
      stopGenerating: "Zatrzymaj generowanie",
      readingGuideTitle: "Pokaż pinyin / furiganę nad tekstem docelowym",
      readingGuide: "Pomoc w czytaniu",
      bilingualTitle: "Język docelowy / ojczysty zdanie po zdaniu",
      bilingualReading: "Czytanie dwujęzyczne",
      btwLabel: "Przy okazji · poza kontekstem",
    },
    settings: {
      general: {
        title: "Ustawienia ogólne",
        interfaceLanguage: "Język interfejsu",
        nativeLanguage: "Język ojczysty",
        targetLanguage: "Język docelowy",
        level: "Poziom",
        dailyGoal: "Cel dzienny",
        theme: "Motyw",
        accent: "Kolor akcentu",
      },
      stt: {
        title: "Wprowadzanie głosowe (STT)",
        onlineGroup: "Online",
        localGroup: "Na urządzeniu",
        disableVoiceInput: "Wyłącz wprowadzanie głosowe",
      },
    },
    viewTitles: {
      today: "Czat",
      mastery: "Dane nauki",
      learning: "Utwórz lekcję",
      customLearning: "Centrum treningu",
      listening: "Słuchanie",
      agents: "Możliwości",
      logs: "Logi",
      general: "Ustawienia",
      llm: "Modele",
      stt: "Głos",
      tts: "Lektor",
      commands: "Polecenia /",
    },
  },
  it: {
    common: {
      edit: "Modifica",
      delete: "Elimina",
      rename: "Rinomina",
      cancel: "Annulla",
      save: "Salva",
      back: "Indietro",
      close: "Chiudi",
      confirm: "Conferma",
      retry: "Riprova",
      loading: "Caricamento…",
      loadFailed: "Caricamento non riuscito",
      copy: "Copia",
      details: "Dettagli",
    },
    errorBoundary: { title: "Qualcosa è andato storto", reload: "Ricarica" },
    speak: { play: "Leggi ad alta voce", stop: "Ferma lettura" },
    onboarding: {
      title: "Benvenuto in Converloop",
      provider: "Provider del modello",
      next: "Avanti",
      finish: "Inizia a imparare",
      skip: "Salta per ora",
    },
    replyExplanation: {
      explain: "Spiega",
      explainTooltip:
        "Spiega questa risposta in base a ciò che hai già acquisito",
    },
    chat: {
      send: "Invia",
      regenerateReply: "Rigenera risposta",
      jumpToLatest: "Vai all’ultimo",
      stopGenerating: "Ferma generazione",
      readingGuideTitle: "Mostra pinyin / furigana sopra il testo obiettivo",
      readingGuide: "Guida alla lettura",
      bilingualTitle: "Lingua obiettivo / madrelingua frase per frase",
      bilingualReading: "Lettura bilingue",
      btwLabel: "A proposito · fuori contesto",
    },
    settings: {
      general: {
        title: "Impostazioni generali",
        interfaceLanguage: "Lingua dell’interfaccia",
        nativeLanguage: "Lingua madre",
        targetLanguage: "Lingua obiettivo",
        level: "Livello",
        dailyGoal: "Obiettivo giornaliero",
        theme: "Tema",
        accent: "Colore accento",
      },
      stt: {
        title: "Input vocale (STT)",
        onlineGroup: "Online",
        localGroup: "Sul dispositivo",
        disableVoiceInput: "Disattiva input vocale",
      },
    },
    viewTitles: {
      today: "Chat",
      mastery: "Dati di apprendimento",
      learning: "Crea lezione",
      customLearning: "Centro allenamento",
      listening: "Ascolto",
      agents: "Capacità",
      logs: "Log",
      general: "Impostazioni",
      llm: "Modelli",
      stt: "Input vocale",
      tts: "Voce",
      commands: "Comandi /",
    },
  },
  ko: {
    common: {
      edit: "편집",
      delete: "삭제",
      rename: "이름 변경",
      cancel: "취소",
      save: "저장",
      back: "뒤로",
      close: "닫기",
      confirm: "확인",
      retry: "다시 시도",
      loading: "불러오는 중…",
      loadFailed: "불러오지 못했습니다",
      copy: "복사",
      details: "상세",
    },
    errorBoundary: { title: "문제가 발생했습니다", reload: "다시 불러오기" },
    speak: { play: "소리 내어 읽기", stop: "읽기 중지" },
    onboarding: {
      title: "Converloop에 오신 것을 환영합니다",
      provider: "모델 제공자",
      next: "다음",
      finish: "학습 시작",
      skip: "지금은 건너뛰기",
    },
    replyExplanation: {
      explain: "설명",
      explainTooltip: "이미 익힌 내용을 바탕으로 이 답변 설명",
    },
    chat: {
      send: "보내기",
      regenerateReply: "답변 다시 생성",
      jumpToLatest: "최신으로 이동",
      stopGenerating: "생성 중지",
      readingGuideTitle: "목표 텍스트 위에 병음 / 후리가나 표시",
      readingGuide: "읽기 도움",
      bilingualTitle: "목표 언어 / 모국어 문장별 보기",
      bilingualReading: "이중언어 읽기",
      btwLabel: "그런데 · 문맥 제외",
    },
    settings: {
      general: {
        title: "일반 설정",
        interfaceLanguage: "인터페이스 언어",
        nativeLanguage: "모국어",
        targetLanguage: "목표 언어",
        level: "레벨",
        dailyGoal: "일일 목표",
        theme: "테마",
        accent: "강조 색상",
      },
      stt: {
        title: "음성 입력 (STT)",
        onlineGroup: "온라인",
        localGroup: "기기 내",
        disableVoiceInput: "음성 입력 끄기",
      },
    },
    viewTitles: {
      today: "채팅",
      mastery: "학습 데이터",
      learning: "수업 만들기",
      customLearning: "훈련 센터",
      listening: "듣기",
      agents: "기능",
      logs: "로그",
      general: "설정",
      llm: "모델",
      stt: "음성 입력",
      tts: "음성",
      commands: "/ 명령",
    },
  },
  th: {
    common: {
      edit: "แก้ไข",
      delete: "ลบ",
      rename: "เปลี่ยนชื่อ",
      cancel: "ยกเลิก",
      save: "บันทึก",
      back: "กลับ",
      close: "ปิด",
      confirm: "ยืนยัน",
      retry: "ลองอีกครั้ง",
      loading: "กำลังโหลด…",
      loadFailed: "โหลดไม่สำเร็จ",
      copy: "คัดลอก",
      details: "รายละเอียด",
    },
    errorBoundary: { title: "มีบางอย่างผิดพลาด", reload: "โหลดใหม่" },
    speak: { play: "อ่านออกเสียง", stop: "หยุดอ่าน" },
    onboarding: {
      title: "ยินดีต้อนรับสู่ Converloop",
      provider: "ผู้ให้บริการโมเดล",
      next: "ถัดไป",
      finish: "เริ่มเรียน",
      skip: "ข้ามไปก่อน",
    },
    replyExplanation: {
      explain: "อธิบาย",
      explainTooltip: "อธิบายคำตอบนี้จากสิ่งที่คุณเชี่ยวชาญแล้ว",
    },
    chat: {
      send: "ส่ง",
      regenerateReply: "สร้างคำตอบใหม่",
      jumpToLatest: "ไปยังล่าสุด",
      stopGenerating: "หยุดสร้าง",
      readingGuideTitle: "แสดงพินอิน / ฟุริงานะเหนือข้อความเป้าหมาย",
      readingGuide: "คู่มือการอ่าน",
      bilingualTitle: "ภาษาเป้าหมาย / ภาษาแม่ ทีละประโยค",
      bilingualReading: "อ่านสองภาษา",
      btwLabel: "อีกเรื่องหนึ่ง · นอกบริบท",
    },
    settings: {
      general: {
        title: "การตั้งค่าทั่วไป",
        interfaceLanguage: "ภาษาอินเทอร์เฟซ",
        nativeLanguage: "ภาษาแม่",
        targetLanguage: "ภาษาเป้าหมาย",
        level: "ระดับ",
        dailyGoal: "เป้าหมายรายวัน",
        theme: "ธีม",
        accent: "สีเน้น",
      },
      stt: {
        title: "ป้อนเสียง (STT)",
        onlineGroup: "ออนไลน์",
        localGroup: "บนอุปกรณ์",
        disableVoiceInput: "ปิดการป้อนเสียง",
      },
    },
    viewTitles: {
      today: "แชต",
      mastery: "ข้อมูลการเรียน",
      learning: "สร้างบทเรียน",
      customLearning: "ศูนย์ฝึก",
      listening: "ฟัง",
      agents: "ความสามารถ",
      logs: "บันทึก",
      general: "ตั้งค่า",
      llm: "โมเดล",
      stt: "ป้อนเสียง",
      tts: "เสียง",
      commands: "คำสั่ง /",
    },
  },
  uk: {
    common: {
      edit: "Редагувати",
      delete: "Видалити",
      rename: "Перейменувати",
      cancel: "Скасувати",
      save: "Зберегти",
      back: "Назад",
      close: "Закрити",
      confirm: "Підтвердити",
      retry: "Спробувати ще",
      loading: "Завантаження…",
      loadFailed: "Не вдалося завантажити",
      copy: "Копіювати",
      details: "Деталі",
    },
    errorBoundary: { title: "Щось пішло не так", reload: "Перезавантажити" },
    speak: { play: "Прочитати вголос", stop: "Зупинити читання" },
    onboarding: {
      title: "Ласкаво просимо до Converloop",
      provider: "Постачальник моделі",
      next: "Далі",
      finish: "Почати навчання",
      skip: "Поки пропустити",
    },
    replyExplanation: {
      explain: "Пояснити",
      explainTooltip:
        "Пояснити цю відповідь на основі того, що ви вже засвоїли",
    },
    chat: {
      send: "Надіслати",
      regenerateReply: "Згенерувати відповідь знову",
      jumpToLatest: "До найновішого",
      stopGenerating: "Зупинити генерацію",
      readingGuideTitle: "Показати піньїнь / фуріґану над цільовим текстом",
      readingGuide: "Підказка читання",
      bilingualTitle: "Цільова / рідна мова речення за реченням",
      bilingualReading: "Двомовне читання",
      btwLabel: "До речі · поза контекстом",
    },
    settings: {
      general: {
        title: "Загальні налаштування",
        interfaceLanguage: "Мова інтерфейсу",
        nativeLanguage: "Рідна мова",
        targetLanguage: "Цільова мова",
        level: "Рівень",
        dailyGoal: "Денна ціль",
        theme: "Тема",
        accent: "Акцентний колір",
      },
      stt: {
        title: "Голосове введення (STT)",
        onlineGroup: "Онлайн",
        localGroup: "На пристрої",
        disableVoiceInput: "Вимкнути голосове введення",
      },
    },
    viewTitles: {
      today: "Чат",
      mastery: "Дані навчання",
      learning: "Створити урок",
      customLearning: "Тренування",
      listening: "Аудіювання",
      agents: "Можливості",
      logs: "Журнали",
      general: "Налаштування",
      llm: "Моделі",
      stt: "Голосове введення",
      tts: "Озвучення",
      commands: "/ команди",
    },
  },
};

const resources: Record<Locale, Messages> = {
  en,
  "zh-CN": zh,
  es: mergeMessages(en, localeOverrides.es),
  pt: mergeMessages(en, localeOverrides.pt),
  "zh-TW": mergeMessages(zh, localeOverrides["zh-TW"]),
  ar: mergeMessages(en, localeOverrides.ar),
  hi: mergeMessages(en, localeOverrides.hi),
  ru: mergeMessages(en, localeOverrides.ru),
  fr: mergeMessages(en, localeOverrides.fr),
  tr: mergeMessages(en, localeOverrides.tr),
  vi: mergeMessages(en, localeOverrides.vi),
  id: mergeMessages(en, localeOverrides.id),
  ja: mergeMessages(en, localeOverrides.ja),
  de: mergeMessages(en, localeOverrides.de),
  bn: mergeMessages(en, localeOverrides.bn),
  pl: mergeMessages(en, localeOverrides.pl),
  it: mergeMessages(en, localeOverrides.it),
  ko: mergeMessages(en, localeOverrides.ko),
  th: mergeMessages(en, localeOverrides.th),
  uk: mergeMessages(en, localeOverrides.uk),
};

const STORAGE_KEY = "lang-agent-locale";

// Recursively collect every leaf path of the message tree as a dot-joined
// string union, e.g. "sidebar.newChat". Gives `t()` autocomplete and stops
// typos at compile time.
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

type InterpolationParams = Record<string, string | number>;

export type TFunction = (
  key: MessageKey,
  params?: InterpolationParams,
) => string;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Resolve a dot path against a locale tree. Falls back to the key itself if a
// value is missing so a missing translation is visible rather than blank.
function resolve(tree: Messages, key: string): string {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in node) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

// Replace {name} placeholders with the matching param value.
function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

function translate(
  locale: Locale,
  key: MessageKey,
  params?: InterpolationParams,
): string {
  return interpolate(resolve(resources[locale], key), params);
}

function isLocale(value: string | null): value is Locale {
  return !!value && value in resources;
}

function normalizeLocale(value: string | null): Locale | null {
  if (!value) return null;
  if (value === "zh") return "zh-CN";
  if (isLocale(value)) return value;
  const lower = value.toLowerCase();
  if (
    lower.startsWith("zh-tw") ||
    lower.startsWith("zh-hk") ||
    lower.startsWith("zh-hant")
  )
    return "zh-TW";
  if (lower.startsWith("zh")) return "zh-CN";
  const base = lower.split("-")[0];
  return isLocale(base) ? base : null;
}

// Pick the initial locale: a previously stored choice wins; otherwise detect
// from the OS/browser language and fall back to English.
function detectLocale(): Locale {
  const stored = normalizeLocale(globalThis.localStorage?.getItem(STORAGE_KEY));
  if (stored) return stored;
  return normalizeLocale(globalThis.navigator?.language) ?? "en";
}

// Provider-free lookup for contexts that can't use the hook (e.g. an error
// boundary mounted above LocaleProvider). Resolves against the stored locale.
export function staticT(key: MessageKey, params?: InterpolationParams): string {
  return translate(detectLocale(), key, params);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  // Reflect the active locale on <html lang> for accessibility and CSS hooks.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => {
    const t: TFunction = (key, params) => translate(locale, key, params);
    return {
      locale,
      setLocale: (next) => {
        localStorage.setItem(STORAGE_KEY, next);
        setLocaleState(next);
      },
      t,
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LocaleContext);
  if (!ctx)
    throw new Error("useTranslation must be used within LocaleProvider");
  return ctx;
}
