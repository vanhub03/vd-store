export function isTelegramHandlerTimeout(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || /promise timed out after \d+ milliseconds/i.test(error.message);
}
