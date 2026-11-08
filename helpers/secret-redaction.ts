export function redactRuntimeSecrets(text: string): string {
  let redacted = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && /(?:KEY|TOKEN|PASSWORD|SECRET|SALT)$/.test(name))
      redacted = redacted.replaceAll(value, "[REDACTED]");
  }
  return redacted;
}
