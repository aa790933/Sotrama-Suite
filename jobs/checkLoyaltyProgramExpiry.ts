import DatabaseCore from '../backend/database/core';
import { ModelNameEnum } from '../models/types';

export async function checkLoyaltyProgramExpiry() {
  const db = new DatabaseCore();

  try {
    if (!db.isConnected) {
      return { timestamp: new Date().toISOString() };
    }

    const currentDate = new Date();

    const loyaltyPrograms = await db.getAll(ModelNameEnum.LoyaltyProgram, {
      fields: ['name', 'toDate', 'status', 'isEnabled', 'maximumUse', 'used'],
      filters: {
        status: ['not in', ['Expired']],
        isEnabled: true,
      },
    });

    if (loyaltyPrograms) {
      for (const program of loyaltyPrograms) {
        const expiryDate =
          program.toDate instanceof Date
            ? program.toDate
            : program.toDate
              ? new Date(program.toDate as string)
              : undefined;
        if (expiryDate && expiryDate <= currentDate) {
          await db.query(
            `UPDATE \`${ModelNameEnum.LoyaltyProgram}\` SET status = ?, isEnabled = ? WHERE name = ?`,
            ['Expired', 0, program.name]
          );
        }
      }
    }

    const result = {
      timestamp: currentDate.toISOString(),
    };

    return result;
  } catch (error) {
    throw error;
  } finally {
    await db.close();
  }
}

checkLoyaltyProgramExpiry().catch((error) => {
  throw error;
});
