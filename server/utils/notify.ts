import { useRuntimeConfig } from '#imports'

// Plain text to every configured channel. No Markdown: nothing in a finding can break the message.
// A failing channel never blocks the others, nor the scan
export async function notify(text: string) {
  const { telegramBotToken, telegramChatId, slackWebhookUrl, discordWebhookUrl, webhookUrl } = useRuntimeConfig()
  const sends: Promise<unknown>[] = []
  if (telegramBotToken && telegramChatId) {
    sends.push($fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      body: { chat_id: telegramChatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } },
    }))
  }
  if (slackWebhookUrl) {
    sends.push($fetch(slackWebhookUrl, { method: 'POST', body: { text: text.slice(0, 3900) } }))
  }
  if (discordWebhookUrl) {
    sends.push($fetch(discordWebhookUrl, { method: 'POST', body: { content: text.slice(0, 1900), allowed_mentions: { parse: [] } } }))
  }
  if (webhookUrl) {
    sends.push($fetch(webhookUrl, { method: 'POST', body: { text } }))
  }
  await Promise.allSettled(sends)
}
