export const formatProxyUsername = (username: string) => {
  // Remove any special characters and format with flushX
  return ("flashX_" + username)
    .replace(/[^a-zA-Z0-9_]/g, "") // Remove all non-alphanumeric characters except underscore
    .toLowerCase(); // Convert to lowercase for consistency
};