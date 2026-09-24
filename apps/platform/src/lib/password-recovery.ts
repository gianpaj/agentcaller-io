export const passwordRequirements =
  "Use at least 8 characters and no more than 1024.";

export function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 8 || password.length > 1024)
    return passwordRequirements;
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}
