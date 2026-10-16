import { redirect } from 'next/navigation'

// "New instruction" now goes directly to the batch creation page,
// which supports 1–20 instructions per submission.
export default function NewTransactionPage() {
  redirect('/transactions/new/batch')
}
