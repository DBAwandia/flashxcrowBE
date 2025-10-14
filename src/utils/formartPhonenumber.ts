export const formatPhoneNumber = (phone: string) => {
  if (!phone || phone?.length !== 10) {
    throw new Error(
      "Invalid phone number format. It should be 10 digits"
    );
  }

  // Remove the first '0' and replace it with '+254'
  return `+254${phone.substring(1)}`;
};
