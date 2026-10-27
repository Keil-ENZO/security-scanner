import { useRuntimeConfig } from '#imports'

// Local LLM through Ollama. Optional: without NUXT_OLLAMA_URL, callers fall back to plain text
export async function chat(system: string, data: unknown, timeoutMs: number): Promise<string | null> {
  const { ollamaUrl, ollamaModel } = useRuntimeConfig()
  if (!ollamaUrl) return null
  const res = await $fetch<{ message: { content: string } }>(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    timeout: timeoutMs,
    body: {
      model: ollamaModel,
      stream: false,
      think: false,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(data) },
      ],
    },
  })
  return res.message.content.trim()
}
