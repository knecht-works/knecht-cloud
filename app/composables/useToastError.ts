export function useToastError() {
  const toast = useToast()
  return (title: string, e: unknown) => {
    // Cancelling the "Confirm it's you" dialog is not a failure.
    if (isReauthError(e)) return
    toast.add({ title, description: errMsg(e, ''), color: 'error' })
  }
}
