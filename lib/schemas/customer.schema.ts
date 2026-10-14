import { z } from 'zod'

export const UpdateCustomerSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters.')
    .max(200, 'Name must be 200 characters or fewer.'),
  registered_phone: z
    .string()
    .max(20, 'Phone must be 20 characters or fewer.')
    .optional()
    .or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
})

export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>
