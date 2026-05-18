import { GeminiProvider } from "./gemini.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAICompatibleProvider } from "./openai-compat.js";
import { TemplateProvider } from "./template.js";
import type { LLMProvider } from "./types.js";

export function createLLMProvider(): LLMProvider {
  const providerName = process.env["LLM_PROVIDER"];

  if (providerName === "gemini") {
    const apiKey = process.env["GEMINI_API_KEY"] ?? "";
    const model = process.env["LLM_MODEL"] ?? "gemini-2.0-flash";
    if (!apiKey) return new TemplateProvider();
    return new GeminiProvider(apiKey, model);
  }

  if (providerName === "ollama") {
    const baseUrl = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
    const model = process.env["LLM_MODEL"] ?? "llama3.2";
    return new OllamaProvider(baseUrl, model);
  }

  if (providerName === "openai-compatible") {
    const baseUrl = process.env["OPENAI_COMPAT_BASE_URL"] ?? "";
    const apiKey = process.env["OPENAI_COMPAT_API_KEY"] ?? "";
    const model = process.env["LLM_MODEL"] ?? "gpt-4o-mini";
    if (!baseUrl) return new TemplateProvider();
    return new OpenAICompatibleProvider(baseUrl, apiKey, model);
  }

  return new TemplateProvider();
}
