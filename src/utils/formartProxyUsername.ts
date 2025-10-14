export const formatProxyUsername = (email: string) => {
    const [username, domain] = email?.split("@"); // Split email into username & domain
    const domainName = domain.split(".")[0]; // Get the first part of the domain
    return ("max_" + domainName + "_" + username)
      .replace(/[\._]/g, "") // Remove dots and underscores
  };