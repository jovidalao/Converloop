/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LLM_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
