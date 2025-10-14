export async function generateUniqueOrderId(
  TransactionModel: any,
  prefix: string = 'SM',
  digits: number = 6
): Promise<string> {
  let orderId: string = '';
  let isUnique = false;

  while (!isUnique) {
    const randomDigits = Math.floor(Math.pow(10, digits - 1) + Math.random() * 9 * Math.pow(10, digits - 1)).toString();
    orderId = `${prefix}${randomDigits}`;
    const existingTransaction = await TransactionModel.findOne({ orderId });
    if (!existingTransaction) isUnique = true;
  }

  return orderId;
}