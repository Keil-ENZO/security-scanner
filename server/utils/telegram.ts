// Bot de Hermes. Texte brut, sans parse_mode : rien dans un finding ne peut casser le message
export async function notify(text: string) {
  const { telegramBotToken, telegramChatId } = useRuntimeConfig()
  if (!telegramBotToken || !telegramChatId) return
  await $fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: 'POST',
    body: { chat_id: telegramChatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } },
  })
}
