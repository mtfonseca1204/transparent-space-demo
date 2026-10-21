/**
 * Telegram Bot API helper.
 *
 * Requires two environment variables:
 *   TELEGRAM_BOT_TOKEN  – token from @BotFather
 *   TELEGRAM_CHAT_ID    – numeric chat / group ID to send messages to
 */

export type InlineKeyboardButton = { text: string; callback_data: string };

function getToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

/** Send an HTML message to the default chat (TELEGRAM_CHAT_ID). */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  const token = getToken();
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn(
      "[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID – skipping message",
    );
    return false;
  }

  return sendTelegramReply(chatId, text);
}

/** Send an HTML message to a specific chat. */
export async function sendTelegramReply(
  chatId: string | number,
  text: string,
): Promise<boolean> {
  const token = getToken();
  if (!token) {
    console.warn("[telegram] Missing TELEGRAM_BOT_TOKEN – skipping message");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[telegram] Failed to send message", {
        status: res.status,
        body: body.slice(0, 400),
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("[telegram] Network error sending message", err);
    return false;
  }
}

/** Send an HTML message with an inline keyboard to a specific chat. */
export async function sendTelegramMessageWithKeyboard(
  chatId: string | number,
  text: string,
  keyboard: InlineKeyboardButton[][],
): Promise<boolean> {
  const token = getToken();
  if (!token) {
    console.warn("[telegram] Missing TELEGRAM_BOT_TOKEN – skipping message");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: keyboard },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[telegram] Failed to send keyboard message", {
        status: res.status,
        body: body.slice(0, 400),
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error("[telegram] Network error sending keyboard message", err);
    return false;
  }
}

/** Acknowledge a callback query (dismisses the button loading spinner). */
export async function answerCallbackQuery(
  callbackQueryId: string,
): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
