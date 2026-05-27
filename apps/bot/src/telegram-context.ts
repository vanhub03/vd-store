import { Context } from "telegraf";

export function isCallbackContext(ctx: Context) {
  return Boolean(callbackMessage(ctx));
}

export function currentCallbackMessageId(ctx: Context) {
  return callbackMessage(ctx)?.message_id;
}

function callbackMessage(ctx: Context) {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !("message" in callbackQuery)) return undefined;
  return callbackQuery.message;
}
